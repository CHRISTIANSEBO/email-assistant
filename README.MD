<div align="center">

# Jean — AI Email Assistant

**Talk to your inbox.** Jean reads, sorts, drafts, sends, and unsubscribes from your Gmail — all through a conversational chat interface powered by Claude.

[Features](#features) · [Quick Start](#quick-start) · [How It Works](#how-it-works) · [Deployment](#deployment)

</div>

---

## The Problem

A busy inbox is a tax on your attention. Promotions and low-priority mail bury the messages that matter, and getting anything done means bouncing between compose, search, labels, and unsubscribe links. The context-switching is the real cost.

## The Solution

Jean is a [ReAct](https://arxiv.org/abs/2210.03629) agent that manages your inbox the way you'd ask a capable assistant to: in plain language. Tell it _"what's urgent?"_, _"open the one from my manager"_, _"reply that I'm on it"_, or _"unsubscribe me from these promos"_ — and it does it, showing your mail as visual cards and asking for a one-tap confirmation before it ever opens private mail or sends on your behalf.

It's a full multi-user web app: sign in with Google, and your Gmail tokens are encrypted at rest and scoped to your account alone.

## Features

- **Conversational inbox control** — natural-language commands to read, sort, open, draft, send, and unsubscribe.
- **Human-in-the-loop confirmations** — Jean always asks before opening a private email or sending anything. Streaming pauses on a confirmation card and resumes once you tap Allow/Deny.
- **Visual email cards** — `read`/`sort` results render as cards (sender, subject, category color, urgency badge), not walls of text.
- **Streaming replies** — responses stream token-by-token over Server-Sent Events, with live "reading your inbox…" tool status.
- **Smart quick replies** — after opening an email, Jean suggests three short, contextual reply options you can send in one tap.
- **Category filtering & urgency sort** — view Primary, Promotions, Social, Updates, or Forums separately; rank by urgency-keyword signals.
- **One-click unsubscribe** — parses the `List-Unsubscribe` header and sends the opt-out for you (with confirmation).
- **Saved templates** — save an email as a reusable template and recall it by name.
- **Multi-user Google sign-in** — OAuth 2.0 login; per-user Gmail tokens **encrypted at rest** (Fernet) so a leaked DB alone grants no inbox access.
- **Persistent chat history** — conversations saved to SQLite, scoped per user, searchable from the sidebar.
- **Prompt-injection hardening** — email content is treated strictly as untrusted data; Jean never follows instructions found inside a message body.
- **Admin panel** — accounts in `ADMIN_EMAILS` get a hidden view of connected users (profile info only — never credentials or mail).
- **Animated UI** — GSAP-powered staggered menu, character-level text entry, and an animated WebGL background.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TypeScript, Vite |
| Animations | GSAP, OGL (WebGL background) |
| Backend | Flask, Gunicorn, Python 3.11 |
| Agent | LangGraph ReAct + LangChain |
| LLM | Anthropic Claude (`claude-haiku-4-5`) |
| Email & Auth | Gmail API, Google OAuth 2.0 |
| Persistence | SQLite (users, chats, templates) |
| Security | Fernet token encryption, CSRF header guard, rate limiting |
| Deployment | Docker, Railway / Nixpacks |

## How It Works

```
Browser (React)
   │  POST /stream  (X-Requested-With: fetch)
   ▼
Flask server.py ──► require_auth ──► per-session state (thread_id, lock, queue)
   │
   ▼
LangGraph ReAct agent (agent/assistant.py)  ◄── system prompt + security rules
   │  picks a tool
   ▼
agent/tools.py ──► Gmail API (read / open / send / sort / unsubscribe / template)
   │
   │  send/open/unsubscribe → pause and ask the user
   ▼
Confirmation card in the UI ──► /confirm ──► tool resumes
   │
   ▼
SSE stream: tokens, tool_start/tool_done, email_list, quick_replies, confirmation
```

The agent never calls `builtins.input()` on the server. Each request installs a
thread-local input override so a tool's confirmation prompt is surfaced to the
browser as a `confirmation` SSE event and resolved via the `/confirm` endpoint —
the same tool code works unchanged for both the web app and the terminal REPL.

Per-user isolation is enforced end to end: a `current_user_id` contextvar
(propagated into worker threads) selects whose encrypted credentials each Gmail
call uses, so concurrent users never share state.

## Agent Tools

| Tool | Description |
|------|-------------|
| `read_email` | Fetch the latest 10 emails (subject + sender); optional category filter |
| `sort_emails` | Fetch and rank the latest emails by urgency keywords |
| `open_email` | Open a specific email's full body — **requires confirmation** |
| `send_email` | Compose and send — shows a preview, **requires confirmation** |
| `summarize_email` | Summarize an email's subject, sender, and body |
| `unsubscribe_from_email` | Opt out via the sender's `List-Unsubscribe` header — **requires confirmation** |
| `save_template` | Save an email as a reusable, named template |

## Quick Start

### Prerequisites
- Python 3.11+
- Node.js 20+
- An [Anthropic API key](https://console.anthropic.com/)
- A Google Cloud project with the **Gmail API** enabled and an OAuth 2.0 Client ID

### 1. Clone and install

```bash
git clone https://github.com/CHRISTIANSEBO/email-assistant.git
cd email-assistant

python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt

cd client && npm install && cd ..
```

### 2. Configure Google OAuth

1. In the [Google Cloud Console](https://console.cloud.google.com/), enable the **Gmail API**.
2. Create an **OAuth 2.0 Client ID** (type: **Web application**).
3. Add `http://localhost:5000/auth/callback` as an authorized redirect URI.
4. On the OAuth consent screen, add these scopes:
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/gmail.send`
   - `https://www.googleapis.com/auth/userinfo.email`
   - `https://www.googleapis.com/auth/userinfo.profile`
   - `openid`
5. Download the credentials and save them as `credentials.json` in the project root.

### 3. Set environment variables

Copy `.env.example` to `.env` and fill in the secrets:

```bash
cp .env.example .env
```

```ini
ANTHROPIC_API_KEY=your_anthropic_api_key_here

# Generate with: python -c "import secrets; print(secrets.token_hex(32))"
FLASK_SECRET_KEY=your_random_secret

# Generate with: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
FERNET_KEY=your_generated_fernet_key

# Optional: emails that get admin access to /admin/users
ADMIN_EMAILS=you@example.com
```

> `FERNET_KEY` encrypts users' OAuth tokens at rest — the server refuses to store credentials without it.

### 4. Run it

In one terminal, start the backend:

```bash
python server.py        # serves the API on http://localhost:5000
```

In another, start the frontend:

```bash
cd client
npm run dev             # serves the UI on http://localhost:5173
```

Open **http://localhost:5173**, click **Sign in with Google**, and start chatting. Tokens are stored encrypted in `chats.db` (auto-created).

### Terminal mode (optional)

A single-user CLI is included for quick local testing. It uses the desktop OAuth
flow (a `token.json` is saved on first run):

```bash
python main.py
```

## Deployment

Jean ships with a multi-stage `Dockerfile` (builds the React frontend, then
serves it from Flask) and is preconfigured for **Railway** (`railway.toml`,
`nixpacks.toml`, `Procfile`).

> ⚠️ **Run exactly one worker.** Rate limits, agent sessions, and pending
> confirmations live in process memory — scale with threads (`--threads`), not
> workers. The included Gunicorn command does this:
> `gunicorn --workers 1 --threads 4 server:app`.

Key production environment variables (see `.env.example` for the full list):

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` | Claude API access |
| `FLASK_SECRET_KEY` | Signs session cookies (required in production) |
| `FERNET_KEY` | Encrypts stored OAuth tokens |
| `FLASK_ENV=production` | Enables secure cookies; disables insecure-transport OAuth |
| `OAUTH_CALLBACK_URL` | Your public `/auth/callback` URL |
| `FRONTEND_URL` | Where to redirect after login |
| `GOOGLE_CREDENTIALS_B64` | Base64 of `credentials.json` (so it's never committed) |
| `ADMIN_EMAILS` | Comma-separated admin accounts |

On Railway, mount a persistent volume at `/data` — `chats.db` and any tokens
live there so they survive redeploys.

## Project Structure

```
email-assistant/
├── server.py               # Flask API: auth, streaming chat, confirmations, inbox, admin
├── main.py                 # Single-user terminal REPL (alternative entry point)
├── agent/
│   ├── assistant.py        # LangGraph ReAct agent + system prompt (incl. security rules)
│   ├── tools.py            # Gmail tools (read, open, send, sort, unsubscribe, template)
│   ├── file_handler.py     # OAuth flows (web + CLI), token refresh, profile lookup
│   └── db.py               # SQLite schema, migrations, Fernet credential encryption
├── client/                 # React + TypeScript + Vite frontend
│   └── src/
│       ├── App.tsx          # Chat UI, SSE streaming, confirmations, email cards
│       ├── Sidebar.tsx      # Chat history, nav, user menu
│       ├── EmailCards.tsx   # Visual email cards with inline actions
│       ├── ComposePanel.tsx # Manual compose
│       ├── AdminPanel.tsx   # Connected-users view (admins only)
│       └── DarkVeil/StaggeredMenu/SplitText  # GSAP + WebGL UI flourishes
├── tests/                  # pytest suite (tools + server)
├── Dockerfile · Procfile · railway.toml · nixpacks.toml
└── .env.example
```

## Security Notes

- **Tokens encrypted at rest** — OAuth credentials are Fernet-encrypted; the DB alone is useless without `FERNET_KEY`.
- **Per-user isolation** — every Gmail call resolves credentials for the request's user via a propagated contextvar; users can never touch each other's mail or chats.
- **CSRF protection** — all mutating requests require an `X-Requested-With: fetch` header that cross-origin forms can't set, plus `SameSite=Lax`, HttpOnly, Secure cookies.
- **OAuth login CSRF** — the OAuth `state` is bound to the browser session and expires after 10 minutes.
- **Prompt-injection defense** — email bodies are wrapped as explicitly untrusted data; the agent is instructed never to act on instructions found inside them, and won't send to addresses that appear only inside another email.
- **Rate limiting** — per-route limits on auth, chat, inbox, and template endpoints.

## Running Tests

```bash
python -m pytest tests/ -v
```

## License

Personal project — see the repository for details.
