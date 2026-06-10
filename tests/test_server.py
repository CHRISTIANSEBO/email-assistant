"""Server-layer tests: CSRF enforcement, auth, OAuth callback state binding,
and per-user authorization on chats/templates."""
import os
import tempfile
import time
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

# Must be set before importing server: the agent and admin list are built at
# module import time, and the DB path is bound when modules load.
os.environ.setdefault('ANTHROPIC_API_KEY', 'test-key')
os.environ.setdefault('ADMIN_EMAILS', 'admin@example.com')

import agent.db as db  # noqa: E402

db.DB_PATH = Path(tempfile.mkdtemp()) / 'test.db'

import server  # noqa: E402

CSRF = {'X-Requested-With': 'fetch'}


@pytest.fixture()
def client():
    server.app.config['TESTING'] = True
    return server.app.test_client()


def _login(client, user_id='user-a'):
    with client.session_transaction() as s:
        s['user_id'] = user_id


# ---------------------------------------------------------------------------
# CSRF header enforcement
# ---------------------------------------------------------------------------

class TestCSRFProtection:
    def test_post_without_header_rejected(self, client):
        assert client.post('/auth/logout').status_code == 403

    def test_post_with_wrong_header_rejected(self, client):
        r = client.post('/auth/logout', headers={'X-Requested-With': 'XMLHttpRequest'})
        assert r.status_code == 403

    def test_post_with_header_accepted(self, client):
        assert client.post('/auth/logout', headers=CSRF).status_code == 200

    def test_get_requests_unaffected(self, client):
        assert client.get('/auth/status').status_code == 200

    def test_confirm_requires_header(self, client):
        """/confirm approves email sends — it must never work via forged POST."""
        _login(client)
        with patch('server.is_authenticated', return_value=True):
            r = client.post('/confirm', json={'confirmed': True})
        assert r.status_code == 403


# ---------------------------------------------------------------------------
# Authentication
# ---------------------------------------------------------------------------

class TestRequireAuth:
    def test_chat_requires_login(self, client):
        r = client.post('/chat', headers=CSRF, json={'message': 'hi'})
        assert r.status_code == 401

    def test_templates_require_login(self, client):
        assert client.get('/templates').status_code == 401

    def test_session_user_must_still_be_connected(self, client):
        _login(client)
        with patch('server.is_authenticated', return_value=False):
            assert client.get('/templates').status_code == 401


# ---------------------------------------------------------------------------
# OAuth callback — state must be bound to the initiating session
# ---------------------------------------------------------------------------

class TestOAuthCallback:
    def _arm(self, client, state='state-1', ttl=600):
        with client.session_transaction() as s:
            s['oauth_state'] = state
            s['oauth_expiry'] = time.time() + ttl

    def test_callback_without_session_state_rejected(self, client):
        r = client.get('/auth/callback?state=anything&code=x')
        assert r.status_code == 400

    def test_mismatched_state_rejected(self, client):
        self._arm(client, state='expected')
        r = client.get('/auth/callback?state=wrong&code=x')
        assert r.status_code == 400

    def test_expired_state_rejected(self, client):
        self._arm(client, ttl=-1)
        r = client.get('/auth/callback?state=state-1&code=x')
        assert r.status_code == 400

    def test_valid_state_passes_and_is_single_use(self, client):
        mock_flow = MagicMock()
        mock_flow.fetch_token.side_effect = Exception('boom')
        self._arm(client)
        with patch('server.create_web_flow', return_value=mock_flow):
            r = client.get('/auth/callback?state=state-1&code=x')
            # Got past state validation (failed later, at token exchange)
            assert b'Invalid or expired auth state' not in r.data
            # Replaying the same callback must fail: the state was consumed
            r = client.get('/auth/callback?state=state-1&code=x')
            assert r.status_code == 400
            assert b'Invalid or expired auth state' in r.data


# ---------------------------------------------------------------------------
# Per-user authorization on chats and templates
# ---------------------------------------------------------------------------

@pytest.fixture()
def authed():
    with patch('server.is_authenticated', return_value=True):
        yield


class TestChatAuthorization:
    def test_users_cannot_read_each_others_chats(self, client, authed):
        _login(client, 'user-a')
        client.post('/chats/chat-1/save', headers=CSRF,
                    json={'title': 'mine', 'messages': []})
        assert client.get('/chats/chat-1').status_code == 200

        _login(client, 'user-b')
        assert client.get('/chats/chat-1').status_code == 404

    def test_save_chat_ignores_client_thread_id(self, client, authed):
        _login(client, 'user-a')
        client.post('/chats/chat-2/save', headers=CSRF,
                    json={'title': 't', 'messages': [], 'thread_id': 'web-stolen'})
        with server._db() as conn:
            row = conn.execute(
                "SELECT thread_id FROM chats WHERE id = 'chat-2'").fetchone()
        assert row['thread_id'] == ''

    def test_delete_only_affects_own_chats(self, client, authed):
        _login(client, 'user-a')
        client.post('/chats/chat-3/save', headers=CSRF,
                    json={'title': 't', 'messages': []})
        _login(client, 'user-b')
        client.delete('/chats/chat-3', headers=CSRF)
        _login(client, 'user-a')
        assert client.get('/chats/chat-3').status_code == 200


class TestTemplateAuthorization:
    def test_templates_are_scoped_per_user(self, client, authed):
        _login(client, 'user-a')
        tid = client.post('/templates', headers=CSRF,
                          json={'name': 'mine'}).get_json()['id']
        assert any(t['id'] == tid for t in client.get('/templates').get_json())

        _login(client, 'user-b')
        assert not any(t['id'] == tid for t in client.get('/templates').get_json())
        client.delete(f'/templates/{tid}', headers=CSRF)

        _login(client, 'user-a')
        assert any(t['id'] == tid for t in client.get('/templates').get_json())


# ---------------------------------------------------------------------------
# Admin access — re-checked against ADMIN_EMAILS on every request
# ---------------------------------------------------------------------------

class TestAdminAccess:
    def _get_users(self, client, email):
        user = {'id': 'u', 'email': email, 'name': '', 'picture': ''}
        with patch('server.is_authenticated', return_value=True), \
             patch('server.get_user', return_value=user):
            return client.get('/admin/users')

    def test_non_admin_sees_404(self, client):
        _login(client)
        assert self._get_users(client, 'other@example.com').status_code == 404

    def test_admin_email_grants_access(self, client):
        _login(client)
        assert self._get_users(client, 'admin@example.com').status_code == 200

    def test_admin_removal_revokes_existing_session(self, client):
        """Admin rights come from the live ADMIN_EMAILS check, not a session
        flag — the same session loses access the moment the email is removed."""
        _login(client)
        assert self._get_users(client, 'admin@example.com').status_code == 200
        with patch.object(server, '_ADMIN_EMAILS', set()):
            assert self._get_users(client, 'admin@example.com').status_code == 404

    def test_anonymous_sees_401(self, client):
        # Anonymous probers hit require_auth first — the same 401 every
        # protected route returns, revealing nothing admin-specific.
        assert client.get('/admin/users').status_code == 401
