// Records demo/index.html to a real video file (and optionally a GIF).
//
// The demo is a self-contained, no-backend replica of Jean's UI that auto-plays
// a full conversation. This script loads it in a headless browser, waits for the
// scripted run to finish, and saves the captured video — so you get an authentic
// "app in action" clip without needing Gmail/Claude credentials or a live server.
//
// Usage:
//   cd demo
//   npm install            # installs playwright (see package.json)
//   npx playwright install chromium
//   node record.mjs        # -> demo/jean-demo.webm  (+ .mp4/.gif if ffmpeg is on PATH)
//
// Output is written next to this file.

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, renameSync, rmSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WIDTH = 1280;
const HEIGHT = 800;
const OUT_WEBM = join(__dirname, 'jean-demo.webm');
const OUT_MP4 = join(__dirname, 'jean-demo.mp4');
const OUT_GIF = join(__dirname, 'jean-demo.gif');

function hasFfmpeg() {
  return spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
}

async function main() {
  console.log('▶ Launching headless Chromium…');
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 2,
    recordVideo: { dir: __dirname, size: { width: WIDTH, height: HEIGHT } },
  });
  const page = await context.newPage();

  // Hide the demo control bar / badge so the recording is clean chrome.
  await page.addInitScript(() => {
    const style = document.createElement('style');
    style.textContent = '.demo-bar,.demo-badge{display:none !important}';
    document.documentElement.appendChild(style);
  });

  const url = 'file://' + join(__dirname, 'index.html');
  console.log('▶ Loading', url);
  await page.goto(url);

  // The scripted player sets #demoStatus to "Finished" when the run completes.
  console.log('▶ Recording the conversation…');
  await page.waitForFunction(
    () => document.getElementById('demoStatus')?.textContent?.trim() === 'Finished',
    { timeout: 90_000 }
  );
  await page.waitForTimeout(1200); // let the final frame breathe

  const video = page.video();
  await context.close(); // finalizes the .webm
  await browser.close();

  // Playwright names the file with a random id; move it to a stable name.
  const saved = video ? await video.path() : null;
  if (saved && existsSync(saved)) {
    if (existsSync(OUT_WEBM)) rmSync(OUT_WEBM);
    renameSync(saved, OUT_WEBM);
  } else {
    // Fallback: grab the most recent .webm in the dir.
    const webm = readdirSync(__dirname).filter(f => f.endsWith('.webm') && f !== 'jean-demo.webm');
    if (webm[0]) renameSync(join(__dirname, webm[0]), OUT_WEBM);
  }
  console.log('✓ Saved', OUT_WEBM);

  if (hasFfmpeg()) {
    console.log('▶ ffmpeg found — encoding MP4…');
    spawnSync('ffmpeg', [
      '-y', '-i', OUT_WEBM,
      '-movflags', 'faststart', '-pix_fmt', 'yuv420p',
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      OUT_MP4,
    ], { stdio: 'inherit' });
    console.log('✓ Saved', OUT_MP4);

    console.log('▶ Encoding optimized GIF…');
    const palette = join(__dirname, '_palette.png');
    spawnSync('ffmpeg', ['-y', '-i', OUT_WEBM, '-vf', 'fps=15,scale=900:-1:flags=lanczos,palettegen', palette], { stdio: 'inherit' });
    spawnSync('ffmpeg', ['-y', '-i', OUT_WEBM, '-i', palette, '-lavfi', 'fps=15,scale=900:-1:flags=lanczos[x];[x][1:v]paletteuse', OUT_GIF], { stdio: 'inherit' });
    if (existsSync(palette)) rmSync(palette);
    console.log('✓ Saved', OUT_GIF);
  } else {
    console.log('ℹ ffmpeg not found — kept .webm only. Install ffmpeg to also get .mp4 and .gif.');
  }

  console.log('\nDone. Drop jean-demo.mp4 (or .gif) into the README demo section.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
