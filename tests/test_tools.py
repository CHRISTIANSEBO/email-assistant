import base64
import pytest
from unittest.mock import MagicMock, patch


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _b64(text: str) -> str:
    """Base64url-encode a string the same way Gmail does."""
    return base64.urlsafe_b64encode(text.encode()).decode()


# ---------------------------------------------------------------------------
# _extract_body
# ---------------------------------------------------------------------------

# Import after patching authenticate_gmail so the module loads without OAuth
with patch("agent.file_handler.authenticate_gmail", return_value=MagicMock()):
    from agent.tools import _extract_body, URGENT_KEYWORDS


class TestExtractBody:
    def test_simple_text_plain(self):
        payload = {"mimeType": "text/plain", "body": {"data": _b64("Hello world")}}
        assert _extract_body(payload) == "Hello world"

    def test_multipart_prefers_plain_over_html(self):
        payload = {
            "mimeType": "multipart/alternative",
            "parts": [
                {"mimeType": "text/html", "body": {"data": _b64("<b>HTML</b>")}},
                {"mimeType": "text/plain", "body": {"data": _b64("Plain text")}},
            ],
        }
        assert _extract_body(payload) == "Plain text"

    def test_multipart_falls_back_to_html(self):
        payload = {
            "mimeType": "multipart/alternative",
            "parts": [
                {"mimeType": "text/html", "body": {"data": _b64("<b>HTML only</b>")}},
            ],
        }
        assert _extract_body(payload) == "<b>HTML only</b>"

    def test_empty_body_data(self):
        payload = {"mimeType": "text/plain", "body": {"data": ""}}
        assert _extract_body(payload) == ""

    def test_no_matching_mime_type(self):
        payload = {"mimeType": "application/pdf", "body": {}}
        assert _extract_body(payload) == ""

    def test_nested_multipart(self):
        inner = {"mimeType": "text/plain", "body": {"data": _b64("Nested plain")}}
        payload = {
            "mimeType": "multipart/mixed",
            "parts": [
                {"mimeType": "multipart/alternative", "parts": [inner]},
            ],
        }
        assert _extract_body(payload) == "Nested plain"


class TestSummarizeEmail:
    def test_summarize_email_formats_correctly(self):
        msg = {"subject": "Test Subject", "sender": "a@b.com", "body": "Hello there"}
        # Import inside to avoid side effects
        from agent.tools import summarize_email
        result = summarize_email.invoke({"msg": msg})
        assert "Subject: Test Subject" in result
        assert "From: a@b.com" in result
        assert "Body: Hello there" in result


# ---------------------------------------------------------------------------
# send_email — email validation
# ---------------------------------------------------------------------------

class TestSendEmailValidation:
    def _call(self, to):
        with patch("agent.tools._get_service", return_value=MagicMock()):
            from agent.tools import send_email
            return send_email.invoke({"to": to, "subject": "Test", "body": "Hi"})

    def test_valid_address_calls_gmail(self):
        mock_svc = MagicMock()
        mock_svc.users().messages().send().execute.return_value = {}
        with patch("agent.tools._get_service", return_value=mock_svc), \
             patch("builtins.input", return_value="y"):
            from agent.tools import send_email
            result = send_email.invoke({"to": "user@example.com", "subject": "Hi", "body": "Hello"})
        assert result == "Email sent successfully."

    def test_user_cancels_send(self):
        with patch("agent.tools._get_service", return_value=MagicMock()), \
             patch("builtins.input", return_value="n"):
            from agent.tools import send_email
            result = send_email.invoke({"to": "user@example.com", "subject": "Hi", "body": "Hello"})
        assert result == "Email cancelled by user."

    def test_invalid_address_rejected(self):
        result = self._call("not-an-email")
        assert "Invalid" in result

    def test_missing_at_symbol_rejected(self):
        result = self._call("userexample.com")
        assert "Invalid" in result

    def test_missing_domain_rejected(self):
        result = self._call("user@")
        assert "Invalid" in result


# ---------------------------------------------------------------------------
# sort_emails — sorting logic
# ---------------------------------------------------------------------------

class TestSortEmails:
    def _make_email(self, subject):
        return {"subject": subject, "sender": "a@b.com"}

    def test_urgent_keyword_in_subject_scores_higher(self):
        emails = [
            self._make_email("Hello"),
            self._make_email("URGENT: review needed"),
        ]
        with patch("agent.tools._fetch_email_headers", return_value=emails):
            from agent.tools import sort_emails
            result = sort_emails.invoke({})
        assert result[0]["subject"] == "URGENT: review needed"

    def test_multiple_keywords_rank_higher(self):
        emails = [
            self._make_email("Deadline and critical issue"),
            self._make_email("Urgent"),
        ]
        with patch("agent.tools._fetch_email_headers", return_value=emails):
            from agent.tools import sort_emails
            result = sort_emails.invoke({})
        assert result[0]["subject"] == "Deadline and critical issue"

    def test_no_keywords_priority_zero(self):
        emails = [self._make_email("Newsletter")]
        with patch("agent.tools._fetch_email_headers", return_value=emails):
            from agent.tools import sort_emails
            result = sort_emails.invoke({})
        assert result[0]["priority"] == 0

    def test_empty_inbox(self):
        with patch("agent.tools._fetch_email_headers", return_value=[]):
            from agent.tools import sort_emails
            result = sort_emails.invoke({})
        assert result == []


# ---------------------------------------------------------------------------
# unsubscribe_from_email — input validation and header parsing
# ---------------------------------------------------------------------------

class TestUnsubscribeFromEmail:
    def _call(self, sender, messages=None, headers=None, confirm="y"):
        mock_service = MagicMock()
        mock_service.users().messages().list().execute.return_value = {
            "messages": messages or []
        }
        if headers is not None:
            mock_service.users().messages().get().execute.return_value = {
                "payload": {"headers": headers}
            }
        with patch("agent.tools._get_service", return_value=mock_service), \
             patch("builtins.input", return_value=confirm):
            from agent.tools import unsubscribe_from_email
            return unsubscribe_from_email.invoke({"sender_email": sender})

    def test_invalid_email_rejected(self):
        result = self._call("not-valid")
        assert "Invalid" in result

    def test_no_emails_found(self):
        result = self._call("sender@example.com", messages=[])
        assert "No emails found" in result

    def test_no_unsubscribe_header(self):
        result = self._call(
            "sender@example.com",
            messages=[{"id": "123"}],
            headers=[{"name": "Subject", "value": "Hi"}],
        )
        assert "No unsubscribe option" in result

    def test_mailto_unsubscribe_sends_email(self):
        mock_service = MagicMock()
        mock_service.users().messages().list().execute.return_value = {"messages": [{"id": "1"}]}
        mock_service.users().messages().get().execute.return_value = {
            "payload": {
                "headers": [
                    {"name": "List-Unsubscribe", "value": "<mailto:unsub@example.com?subject=Unsubscribe>"}
                ]
            }
        }
        mock_service.users().messages().send().execute.return_value = {}
        with patch("agent.tools._get_service", return_value=mock_service), \
             patch("builtins.input", return_value="y"):
            from agent.tools import unsubscribe_from_email
            result = unsubscribe_from_email.invoke({"sender_email": "sender@example.com"})
        assert "Unsubscribe email sent" in result

    def test_url_unsubscribe_returns_link(self):
        result = self._call(
            "sender@example.com",
            messages=[{"id": "1"}],
            headers=[
                {"name": "List-Unsubscribe", "value": "<https://example.com/unsub>"}
            ],
        )
        assert "https://example.com/unsub" in result

    def test_url_unsubscribe_cancelled(self):
        mock_service = MagicMock()
        mock_service.users().messages().list().execute.return_value = {"messages": [{"id": "1"}]}
        mock_service.users().messages().get().execute.return_value = {
            "payload": {
                "headers": [
                    {"name": "List-Unsubscribe", "value": "<https://example.com/unsub>"}
                ]
            }
        }
        with patch("agent.tools._get_service", return_value=mock_service), \
             patch("builtins.input", return_value="n"):
            from agent.tools import unsubscribe_from_email
            result = unsubscribe_from_email.invoke({"sender_email": "sender@example.com"})
        assert result == "Unsubscribe cancelled by user."
