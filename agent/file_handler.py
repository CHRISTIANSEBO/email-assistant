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
_TOKEN_PATH = _BASE_DIR / 'token.json'
_CREDENTIALS_PATH = _BASE_DIR / 'credentials.json'

def _load_credentials() -> Credentials:
    """Load, refresh, and return OAuth credentials. Does not build a service."""
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

    return creds


def is_authenticated() -> bool:
    """Check if valid credentials exist without triggering a new OAuth flow."""
    if not _TOKEN_PATH.exists():
        return False
    try:
        creds = Credentials.from_authorized_user_file(str(_TOKEN_PATH))
        if creds.valid:
            return True
        if creds.expired and creds.refresh_token:
            from google.auth.transport.requests import Request
            creds.refresh(Request())
            with open(_TOKEN_PATH, 'w') as f:
                f.write(creds.to_json())
            return True
        return False
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
    """Fetch the authenticated user's name, email, and profile picture."""
    try:
        service = build('oauth2', 'v2', credentials=creds)
        info = service.userinfo().get().execute()
        return {
            'name': info.get('name', ''),
            'email': info.get('email', ''),
            'picture': info.get('picture', ''),
        }
    except Exception:
        return {'name': '', 'email': '', 'picture': ''}


def authenticate_gmail():
    """Load credentials and build a Gmail API service instance."""
    creds = _load_credentials()
    return build('gmail', 'v1', credentials=creds)
