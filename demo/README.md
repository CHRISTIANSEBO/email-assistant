# Jean — Demo

This folder holds the demo assets for Jean and a one-command recorder that turns
them into a video of the app in action.

## Files

| File | What it is |
|------|------------|
| `index.html` | A **self-contained, no-backend** replica of Jean's UI that auto-plays a full conversation (read inbox → email cards → open with confirmation → quick replies → send). Open it in any browser — it runs like a live video, with a **↻ Replay** button. |
| `record.mjs` | A Playwright script that loads `index.html`, waits for the scripted run to finish, and saves a real video file. |
| `package.json` | Pins Playwright for the recorder. |
| `research-agent-gif.gif`, `research-agent-demo.png` | Static captures used in the main README. |

## Why a recorder instead of a checked-in video?

Recording the **live** app would require a Google OAuth login, an Anthropic API
key, and a real inbox — none of which belong in the repo. The `index.html` demo
is a faithful, credential-free stand-in: it uses the real app's exact styling and
flow, so a recording of it is an honest "app in action" clip that anyone can
regenerate deterministically.

## Generate the video

From this `demo/` directory, on a machine with internet access:

```bash
npm install                      # installs Playwright
npx playwright install chromium  # one-time browser download
node record.mjs                  # -> jean-demo.webm  (+ .mp4 and .gif if ffmpeg is installed)
```

- Without `ffmpeg`, you get `jean-demo.webm`.
- With `ffmpeg` on your PATH, you also get `jean-demo.mp4` and an optimized
  `jean-demo.gif`.

Then reference the result from the main `README.MD`, e.g.:

```markdown
![Jean in action](demo/jean-demo.gif)
```

## Recording the *real* app instead

If you'd rather capture the actual product, run it locally (see the root README's
**Quick Start**), sign in with Google, and use any screen recorder — or point a
Playwright script at `http://localhost:5173` instead of `index.html`.
