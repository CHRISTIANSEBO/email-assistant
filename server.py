import json
import os
import queue
import secrets
import sqlite3
import threading
import uuid
from pathlib import Path
from flask import Flask, request, jsonify, Response, stream_with_context, redirect, session
from langchain_core.messages import AIMessageChunk, ToolMessage
from langgraph.checkpoint.memory import MemorySaver
from agent.assistant import create_agent
from agent.file_handler import (
    is_authenticated, create_web_flow, get_user_profile,
    _load_credentials, _TOKEN_PATH,
)
import builtins as _builtins
import anthropic as _anthropic

# Required for OAuth over plain HTTP on localhost
os.environ.setdefault('OAUTHLIB_INSECURE_TRANSPORT', '1')

app = Flask(__name__)
app.secret_key = os.getenv('FLASK_SECRET_KEY', 'jean-dev-secret-key')

_CALLBACK_URL  = 'http://localhost:5000/auth/callback'
_FRONTEND_URL  = os.getenv('FRONTEND_URL', 'http://localhost:5173')
_oauth_states: dict[str, str | None] = {}  # state -> code_verifier
checkpointer = MemorySaver()
agent = create_agent(checkpointer=checkpointer)

_DB_PATH = Path(__file__).parent / 'chats.db'


def _db():
    conn = sqlite3.connect(_DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _init_db():
    with _db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS chats (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                messages TEXT NOT NULL DEFAULT '[]',
                thread_id TEXT NOT NULL,
                created_at REAL NOT NULL DEFAULT (unixepoch('now'))
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS templates (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                subject TEXT NOT NULL DEFAULT '',
                body TEXT NOT NULL DEFAULT '',
                created_at REAL NOT NULL DEFAULT (unixepoch('now'))
            )
        """)


_init_db()

_lock = threading.Lock()
_thread_id = "web"
_state = {
    'active_rid': None,
    'pending_prompt': None,
    'input_event': None,
    'input_response': None,
    'ready': threading.Event(),
    'result': None,
    'error': None,
    'stream_queue': None,
}


# ── Non-streaming input override (used by /chat) ──────────────────────────────

def _make_web_input(rid: str):
    def _web_input(prompt: str) -> str:
        with _lock:
            if _state['active_rid'] != rid:
                return 'n'
        input_event = threading.Event()
        with _lock:
            _state['pending_prompt'] = prompt
            _state['input_event'] = input_event
            _state['input_response'] = None
        _state['ready'].set()
        input_event.wait()
        return _state['input_response'] or 'n'
    return _web_input


# ── Streaming input override (used by /stream) ────────────────────────────────

def _make_web_input_streaming(rid: str, out_queue: queue.Queue):
    def _web_input(prompt: str) -> str:
        with _lock:
            if _state['active_rid'] != rid:
                return 'n'
        input_event = threading.Event()
        with _lock:
            _state['pending_prompt'] = prompt
            _state['input_event'] = input_event
            _state['input_response'] = None
        out_queue.put({'type': 'confirmation', 'prompt': prompt})
        input_event.wait()
        out_queue.put({'type': 'confirmation_resolved'})
        return _state['input_response'] or 'n'
    return _web_input


# ── Non-streaming agent runner (used by /chat) ────────────────────────────────

def _run_agent(user_input: str, rid: str) -> None:
    global _thread_id
    original_input = _builtins.input
    _builtins.input = _make_web_input(rid)
    try:
        with _lock:
            tid = _thread_id
        try:
            response = agent.invoke(
                {'messages': [{'role': 'user', 'content': user_input}]},
                config={"configurable": {"thread_id": tid}}
            )
        except ValueError as e:
            if 'INVALID_CHAT_HISTORY' not in str(e):
                raise
            with _lock:
                _thread_id = f"web-{uuid.uuid4().hex[:8]}"
                tid = _thread_id
            response = agent.invoke(
                {'messages': [{'role': 'user', 'content': user_input}]},
                config={"configurable": {"thread_id": tid}}
            )
        with _lock:
            if _state['active_rid'] == rid:
                _state['result'] = response['messages'][-1].content
                _state['error'] = None
    except Exception as e:
        msg = str(e)
        err = ("I'm being rate-limited right now. Wait a moment and try again."
               if '429' in msg or 'rate_limit' in msg.lower()
               else f"Something went wrong: {type(e).__name__}: {e}")
        with _lock:
            if _state['active_rid'] == rid:
                _state['error'] = err
                _state['result'] = None
    finally:
        _builtins.input = original_input
        with _lock:
            if _state['active_rid'] == rid:
                _state['ready'].set()


# ── Streaming helpers ─────────────────────────────────────────────────────────

def _generate_quick_replies(email_content: str) -> list:
    """Ask Claude Haiku for 3 short reply options based on an opened email."""
    try:
        client = _anthropic.Anthropic(api_key=os.getenv('ANTHROPIC_API_KEY'))
        resp = client.messages.create(
            model='claude-haiku-4-5-20251001',
            max_tokens=120,
            messages=[{
                'role': 'user',
                'content': (
                    'Given this email, suggest exactly 3 very short reply options (max 7 words each). '
                    'Return a JSON array only — no other text.\n\n'
                    f'Email:\n{email_content[:700]}\n\n'
                    'Format: ["reply one", "reply two", "reply three"]'
                )
            }]
        )
        text = resp.content[0].text.strip()
        replies = json.loads(text)
        return replies[:3] if isinstance(replies, list) else []
    except Exception:
        return []


def _process_stream(stream_gen, rid: str, out_queue: queue.Queue) -> None:
    """Iterate a LangGraph message stream and push SSE-ready dicts to out_queue."""
    last_tool_name = None
    for chunk, _metadata in stream_gen:
        with _lock:
            if _state['active_rid'] != rid:
                return

        if isinstance(chunk, AIMessageChunk):
            content = chunk.content
            if isinstance(content, str) and content:
                out_queue.put({'type': 'token', 'text': content})
            elif isinstance(content, list):
                for block in content:
                    if not isinstance(block, dict):
                        continue
                    btype = block.get('type', '')
                    if btype == 'text' and block.get('text'):
                        out_queue.put({'type': 'token', 'text': block['text']})
                    elif btype == 'tool_use' and block.get('name'):
                        name = block['name']
                        if name != last_tool_name:
                            out_queue.put({'type': 'tool_start', 'tool': name})
                            last_tool_name = name

            # tool_call_chunks is an alternative Anthropic streaming path
            for tc in (getattr(chunk, 'tool_call_chunks', None) or []):
                name = tc.get('name') if isinstance(tc, dict) else getattr(tc, 'name', None)
                if name and name != last_tool_name:
                    out_queue.put({'type': 'tool_start', 'tool': name})
                    last_tool_name = name

        elif isinstance(chunk, ToolMessage):
            last_tool_name = None
            out_queue.put({'type': 'tool_done'})

            tool_name = getattr(chunk, 'name', None) or ''

            # Structured email cards for read / sort
            if tool_name in ('read_email', 'sort_emails'):
                try:
                    raw = chunk.content
                    emails = json.loads(raw) if isinstance(raw, str) else raw
                    if isinstance(emails, list) and emails:
                        normalized = [
                            e for e in emails
                            if isinstance(e, dict) and e.get('subject') and e.get('sender')
                        ]
                        if normalized:
                            out_queue.put({'type': 'email_list', 'emails': normalized})
                except Exception:
                    pass

            # Quick reply suggestions after opening a full email
            if tool_name == 'open_email':
                content = chunk.content or ''
                if isinstance(content, str) and 'Body:' in content:
                    replies = _generate_quick_replies(content)
                    if replies:
                        out_queue.put({'type': 'quick_replies', 'replies': replies})


def _run_agent_streaming(user_input: str, rid: str, out_queue: queue.Queue) -> None:
    global _thread_id
    original_input = _builtins.input
    _builtins.input = _make_web_input_streaming(rid, out_queue)
    try:
        with _lock:
            tid = _thread_id

        def _do_stream(thread_id: str):
            return agent.stream(
                {'messages': [{'role': 'user', 'content': user_input}]},
                config={'configurable': {'thread_id': thread_id}},
                stream_mode='messages'
            )

        try:
            _process_stream(_do_stream(tid), rid, out_queue)
        except ValueError as e:
            if 'INVALID_CHAT_HISTORY' not in str(e):
                raise
            with _lock:
                _thread_id = f"web-{uuid.uuid4().hex[:8]}"
                tid = _thread_id
            _process_stream(_do_stream(tid), rid, out_queue)

        with _lock:
            if _state['active_rid'] == rid:
                out_queue.put({'type': 'done', 'thread_id': _thread_id})
    except Exception as e:
        msg = str(e)
        err = ("I'm being rate-limited right now. Wait a moment and try again."
               if '429' in msg or 'rate_limit' in msg.lower()
               else f"Something went wrong: {type(e).__name__}: {e}")
        with _lock:
            if _state['active_rid'] == rid:
                out_queue.put({'type': 'error', 'message': err})
    finally:
        _builtins.input = original_input
        with _lock:
            if _state['active_rid'] == rid:
                _state['stream_queue'] = None


# ── Shared wait helper (non-streaming only) ───────────────────────────────────

def _wait_for_agent() -> dict:
    timeout = 120
    deadline = threading.Event()
    timer = threading.Timer(timeout, deadline.set)
    timer.start()
    try:
        while not deadline.is_set():
            _state['ready'].wait(timeout=1)
            _state['ready'].clear()
            with _lock:
                if _state['input_event'] and not _state['input_event'].is_set():
                    return {'type': 'confirmation', 'prompt': _state['pending_prompt'], 'reply': ''}
                if _state['error'] is not None:
                    return {'type': 'message', 'reply': _state['error']}
                if _state['result'] is not None:
                    return {'type': 'message', 'reply': _state['result']}
    finally:
        timer.cancel()
    return {'type': 'message', 'reply': 'Request timed out. Please try again.'}


# ── Auth routes ───────────────────────────────────────────────────────────────

@app.route('/auth/status')
def auth_status():
    return jsonify({'authenticated': is_authenticated()})


@app.route('/auth/login')
def auth_login():
    state = secrets.token_urlsafe(16)
    flow = create_web_flow(_CALLBACK_URL)
    auth_url, _ = flow.authorization_url(
        prompt='consent', access_type='offline', state=state
    )
    # Store code_verifier so the callback can pass it to fetch_token (PKCE)
    _oauth_states[state] = getattr(flow, 'code_verifier', None)
    return jsonify({'url': auth_url})


@app.route('/auth/callback')
def auth_callback():
    state = request.args.get('state', '')
    if state not in _oauth_states:
        return 'Invalid or expired auth state.', 400
    code_verifier = _oauth_states.pop(state)
    flow = create_web_flow(_CALLBACK_URL)
    try:
        extra = {'code_verifier': code_verifier} if code_verifier else {}
        flow.fetch_token(authorization_response=request.url, **extra)
    except Exception as e:
        return f'Auth error: {e}', 400
    with open(_TOKEN_PATH, 'w') as f:
        f.write(flow.credentials.to_json())
    return redirect(_FRONTEND_URL)


@app.route('/auth/logout', methods=['POST'])
def auth_logout():
    _TOKEN_PATH.unlink(missing_ok=True)
    return jsonify({'ok': True})


@app.route('/auth/profile')
def auth_profile():
    try:
        creds = _load_credentials()
        return jsonify(get_user_profile(creds))
    except Exception as e:
        return jsonify({'error': str(e)}), 401


# ── DB routes ─────────────────────────────────────────────────────────────────

@app.route('/chats', methods=['GET'])
def list_chats():
    with _db() as conn:
        rows = conn.execute(
            "SELECT id, title FROM chats ORDER BY created_at DESC LIMIT 50"
        ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route('/chats/<chat_id>', methods=['GET'])
def get_chat(chat_id: str):
    with _db() as conn:
        row = conn.execute("SELECT * FROM chats WHERE id = ?", (chat_id,)).fetchone()
    if not row:
        return jsonify({'error': 'Not found'}), 404
    data = dict(row)
    data['messages'] = json.loads(data['messages'])
    return jsonify(data)


@app.route('/chats/<chat_id>/save', methods=['POST'])
def save_chat(chat_id: str):
    body = request.json or {}
    messages = body.get('messages', [])
    title = body.get('title', 'Untitled')
    with _db() as conn:
        conn.execute("""
            INSERT INTO chats (id, title, messages, thread_id)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET messages = excluded.messages, title = excluded.title
        """, (chat_id, title, json.dumps(messages), body.get('thread_id', '')))
    return jsonify({'ok': True})


@app.route('/chats/<chat_id>', methods=['DELETE'])
def delete_chat(chat_id: str):
    with _db() as conn:
        conn.execute("DELETE FROM chats WHERE id = ?", (chat_id,))
    return jsonify({'ok': True})


@app.route('/chats/search', methods=['GET'])
def search_chats():
    q = request.args.get('q', '').strip()
    if len(q) < 2:
        return jsonify([])
    pattern = f'%{q}%'
    with _db() as conn:
        rows = conn.execute(
            "SELECT id, title FROM chats WHERE title LIKE ? OR messages LIKE ? ORDER BY created_at DESC LIMIT 20",
            (pattern, pattern)
        ).fetchall()
    return jsonify([dict(r) for r in rows])


# ── Templates ─────────────────────────────────────────────────────────────────

@app.route('/templates', methods=['GET'])
def list_templates():
    with _db() as conn:
        rows = conn.execute(
            "SELECT id, name, subject, body FROM templates ORDER BY created_at DESC"
        ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route('/templates', methods=['POST'])
def create_template():
    body = request.json or {}
    tid = uuid.uuid4().hex
    with _db() as conn:
        conn.execute(
            "INSERT INTO templates (id, name, subject, body) VALUES (?, ?, ?, ?)",
            (tid, body.get('name', 'Untitled'), body.get('subject', ''), body.get('body', ''))
        )
    return jsonify({'id': tid, 'ok': True})


@app.route('/templates/<template_id>', methods=['DELETE'])
def delete_template(template_id: str):
    with _db() as conn:
        conn.execute("DELETE FROM templates WHERE id = ?", (template_id,))
    return jsonify({'ok': True})


# ── Direct inbox fetch (bypasses Jean for speed) ──────────────────────────────

_CATEGORY_LABEL = {
    'primary':    'CATEGORY_PERSONAL',
    'promotions': 'CATEGORY_PROMOTIONS',
    'social':     'CATEGORY_SOCIAL',
    'updates':    'CATEGORY_UPDATES',
    'forums':     'CATEGORY_FORUMS',
}

@app.route('/inbox', methods=['GET'])
def get_inbox():
    from agent.tools import _get_service, _fetch_one_headers, URGENT_KEYWORDS
    from concurrent.futures import ThreadPoolExecutor, as_completed as _as_completed

    category = request.args.get('category', '').lower()
    sort_by  = request.args.get('sort', '')

    if category == 'sent':
        label_ids = ['SENT']
    elif category in _CATEGORY_LABEL:
        label_ids = ['INBOX', _CATEGORY_LABEL[category]]
    else:
        label_ids = ['INBOX']

    try:
        results = _get_service().users().messages().list(
            userId='me', maxResults=20, labelIds=label_ids
        ).execute()
        msg_ids = [m['id'] for m in results.get('messages', [])]
        if not msg_ids:
            return jsonify([])

        with ThreadPoolExecutor(max_workers=min(len(msg_ids), 10)) as ex:
            futures = {ex.submit(_fetch_one_headers, mid): mid for mid in msg_ids}
            emails = [f.result() for f in _as_completed(futures)]

        if sort_by == 'priority':
            for e in emails:
                e['priority'] = sum(1 for kw in URGENT_KEYWORDS if kw in e['subject'].lower())
            emails.sort(key=lambda e: e['priority'], reverse=True)

        return jsonify(emails)
    except Exception as exc:
        return jsonify({'error': str(exc)}), 500


# ── Non-streaming chat (used by main.py terminal REPL) ───────────────────────

@app.route('/chat', methods=['POST'])
def chat():
    global _thread_id
    body = request.json or {}
    user_input = body.get('message', '').strip()
    chat_id = body.get('chat_id') or None
    if not user_input:
        return jsonify({'error': 'Empty message'}), 400

    if chat_id:
        with _db() as conn:
            row = conn.execute("SELECT thread_id FROM chats WHERE id = ?", (chat_id,)).fetchone()
        if row and row['thread_id']:
            with _lock:
                _thread_id = row['thread_id']
    else:
        chat_id = uuid.uuid4().hex
        with _lock:
            tid = _thread_id
        with _db() as conn:
            conn.execute(
                "INSERT OR IGNORE INTO chats (id, title, messages, thread_id) VALUES (?, ?, ?, ?)",
                (chat_id, user_input[:60], '[]', tid)
            )

    rid = uuid.uuid4().hex
    with _lock:
        old_event = _state['input_event']
        if old_event and not old_event.is_set():
            _state['input_response'] = 'n'
            _state['input_event'] = None
            _thread_id = f"web-{uuid.uuid4().hex[:8]}"
            old_event.set()
        _state['active_rid'] = rid
        _state['result'] = None
        _state['error'] = None
        _state['pending_prompt'] = None
        _state['input_event'] = None
        _state['stream_queue'] = None
    _state['ready'].clear()
    threading.Thread(target=_run_agent, args=(user_input, rid), daemon=True).start()
    result = _wait_for_agent()
    result['chat_id'] = chat_id
    with _lock:
        result['thread_id'] = _thread_id
    return jsonify(result)


# ── Streaming chat endpoint ───────────────────────────────────────────────────

@app.route('/stream', methods=['POST'])
def stream_chat():
    global _thread_id
    body = request.json or {}
    user_input = body.get('message', '').strip()
    chat_id = body.get('chat_id') or None
    if not user_input:
        return jsonify({'error': 'Empty message'}), 400

    if chat_id:
        with _db() as conn:
            row = conn.execute("SELECT thread_id FROM chats WHERE id = ?", (chat_id,)).fetchone()
        if row and row['thread_id']:
            with _lock:
                _thread_id = row['thread_id']
    else:
        chat_id = uuid.uuid4().hex
        with _lock:
            tid = _thread_id
        with _db() as conn:
            conn.execute(
                "INSERT OR IGNORE INTO chats (id, title, messages, thread_id) VALUES (?, ?, ?, ?)",
                (chat_id, user_input[:60], '[]', tid)
            )

    out_queue: queue.Queue = queue.Queue()
    rid = uuid.uuid4().hex

    with _lock:
        old_event = _state['input_event']
        if old_event and not old_event.is_set():
            _state['input_response'] = 'n'
            _state['input_event'] = None
            _thread_id = f"web-{uuid.uuid4().hex[:8]}"
            old_event.set()
        _state['active_rid'] = rid
        _state['result'] = None
        _state['error'] = None
        _state['pending_prompt'] = None
        _state['input_event'] = None
        _state['stream_queue'] = out_queue
    _state['ready'].clear()

    threading.Thread(
        target=_run_agent_streaming,
        args=(user_input, rid, out_queue),
        daemon=True
    ).start()

    def generate():
        try:
            with _lock:
                tid = _thread_id
            yield f"data: {json.dumps({'type': 'start', 'chat_id': chat_id, 'thread_id': tid})}\n\n"

            waiting_confirmation = False
            while True:
                # Allow longer wait when user is deciding on a confirmation
                timeout = 300 if waiting_confirmation else 120
                try:
                    event = out_queue.get(timeout=timeout)
                except queue.Empty:
                    msg = ('Confirmation timed out.'
                           if waiting_confirmation else 'Request timed out.')
                    yield f"data: {json.dumps({'type': 'error', 'message': msg})}\n\n"
                    break

                yield f"data: {json.dumps(event)}\n\n"

                if event['type'] == 'confirmation':
                    waiting_confirmation = True
                elif event['type'] == 'confirmation_resolved':
                    waiting_confirmation = False
                elif event['type'] in ('done', 'error'):
                    break
        except GeneratorExit:
            # Client disconnected — invalidate this request so the agent thread exits early
            with _lock:
                if _state['active_rid'] == rid:
                    _state['active_rid'] = None

    return Response(
        stream_with_context(generate()),
        mimetype='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no',
        }
    )


# ── Confirmation endpoint (works for both streaming and non-streaming) ────────

@app.route('/confirm', methods=['POST'])
def confirm():
    answer = 'y' if (request.json or {}).get('confirmed') else 'n'
    with _lock:
        event = _state['input_event']
        if not event or event.is_set():
            return jsonify({'error': 'No pending confirmation'}), 400
        _state['input_response'] = answer
        _state['input_event'] = None
        is_streaming = _state['stream_queue'] is not None
    _state['ready'].clear()
    event.set()

    if is_streaming:
        # SSE stream delivers subsequent tokens; just acknowledge
        return jsonify({'ok': True})
    return jsonify(_wait_for_agent())


if __name__ == '__main__':
    app.run(debug=False, use_reloader=False, threaded=True, port=5000)
