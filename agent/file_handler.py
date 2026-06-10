import base64
import json
import os
from pathlib import Path
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

SCOPES = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'openid',
]

# Paths resolved relative to this file, not the working directory
_BASE_DIR = Path(__file__).parent.parent
# In production (Railway) persistent files live on the volume at /data
# so they survive redeploys. Fall back to project root for local dev.
_DATA_DIR = Path('/data') if Path('/data').exists() else _BASE_DIR
_TOKEN_PATH = _DATA_DIR / 'token.json'
_CREDENTIALS_PATH = _BASE_DIR / 'credentials.json'


def _ensure_credentials_file() -> None:
    """Write credentials.json from GOOGLE_CREDENTIALS_B64 env var if the file is absent.
    This lets Railway (and other cloud hosts) inject the file via a secret env var
    instead of baking it into the image or mounting a volume."""
    if _CREDENTIALS_PATH.exists():
        return
    b64 = os.getenv('GOOGLE_CREDENTIALS_B64', '').strip()
    if not b64:
        return
    _CREDENTIALS_PATH.write_bytes(base64.b64decode(b64))


_ensure_credentials_file()


def _load_credentials_cli() -> Credentials:
    """Load, refresh, and return OAuth credentials for the local CLI (main.py).
    Uses a single token.json file — there is only one user in this mode."""
    if not _CREDENTIALS_PATH.exists():
        raise FileNotFoundError(
            f"credentials.json not found at {_CREDENTIALS_PATH}. "
            "Download it from Google Cloud Console and place it in the project root."
        )

    creds = None

    if _TOKEN_PATH.exists():
        creds = Credentials.from_authorized_user_file(str(_TOKEN_PATH), SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            from google.auth.transport.requests import Request
            try:
                creds.refresh(Request())
            except Exception:
                _TOKEN_PATH.unlink(missing_ok=True)
                creds = None
        if not creds:
            flow = InstalledAppFlow.from_client_secrets_file(str(_CREDENTIALS_PATH), SCOPES)
            creds = flow.run_local_server(port=0, prompt='consent')

        with open(_TOKEN_PATH, 'w') as token:
            token.write(creds.to_json())
        os.chmod(_TOKEN_PATH, 0o600)

    return creds


def load_credentials_for_user(user_id: str | None) -> Credentials:
    """Load, refresh, and return OAuth credentials for a web user.

    `user_id` is the Google account id (sub) used as the primary key in the
    `users` table. Each user's tokens are stored encrypted in the database, so
    one user's credentials are never accessible to another. If `user_id` is
    None, falls back to the single-user CLI token file (main.py / terminal use)."""
    if user_id is None:
        return _load_credentials_cli()

    from agent.db import get_user_credentials, save_user_credentials

    creds_json = get_user_credentials(user_id)
    if not creds_json:
        raise FileNotFoundError(f"No stored credentials for user {user_id}")

    creds = Credentials.from_authorized_user_info(json.loads(creds_json), SCOPES)

    if not creds.valid:
        if creds.expired and creds.refresh_token:
            from google.auth.transport.requests import Request
            creds.refresh(Request())
            save_user_credentials(user_id, creds.to_json())
        else:
            raise RuntimeError("Stored credentials are invalid and cannot be refreshed.")

    return creds


def is_authenticated(user_id: str | None) -> bool:
    """Check if valid (or refreshable) credentials exist for this user."""
    if not user_id:
        return False
    try:
        load_credentials_for_user(user_id)
        return True
    except Exception:
        return False


def create_web_flow(redirect_uri: str):
    """Create an OAuth2 flow suitable for web-based login."""
    from google_auth_oauthlib.flow import Flow
    return Flow.from_client_secrets_file(
        str(_CREDENTIALS_PATH),
        scopes=SCOPES,
        redirect_uri=redirect_uri,
    )


def get_user_profile(creds) -> dict:
    """Fetch the authenticated user's Google account id, name, email, and picture."""
    try:
        service = build('oauth2', 'v2', credentials=creds, cache_discovery=False)
        info = service.userinfo().get().execute()
        return {
            'id': info.get('id', ''),
            'name': info.get('name', ''),
            'email': info.get('email', ''),
            'picture': info.get('picture', ''),
        }
    except Exception:
        return {'id': '', 'name': '', 'email': '', 'picture': ''}


def authenticate_gmail():
    """Load credentials and build a Gmail API service instance (CLI use)."""
    creds = _load_credentials_cli()
    return build('gmail', 'v1', credentials=creds, cache_discovery=False)
