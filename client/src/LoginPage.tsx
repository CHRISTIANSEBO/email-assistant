import { useState } from 'react';
import './LoginPage.css';

export default function LoginPage() {
  const [termsOpen, setTermsOpen] = useState(false);

  const handleLogin = async () => {
    const res = await fetch('/auth/login');
    const { url } = await res.json();
    window.location.href = url;
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-avatar">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="rgba(190,150,255,0.9)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
            <polyline points="22,6 12,13 2,6"/>
          </svg>
        </div>
        <h1 className="login-title">Jean</h1>
        <p className="login-sub">Your personal email assistant</p>
        <button type="button" className="login-google-btn" onClick={handleLogin}>
          <GoogleIcon />
          Sign in with Google
        </button>
        <p className="login-note">
          By signing in you agree to our{' '}
          <button type="button" className="login-terms-link" onClick={() => setTermsOpen(true)}>
            Privacy &amp; Terms
          </button>
        </p>
      </div>

      {termsOpen && <TermsModal onClose={() => setTermsOpen(false)} />}
    </div>
  );
}

function TermsModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="terms-overlay" onClick={onClose}>
      <div className="terms-modal" onClick={e => e.stopPropagation()}>
        <div className="terms-header">
          <h2 className="terms-title">Privacy &amp; Terms</h2>
          <button type="button" className="terms-close" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div className="terms-body">
          <p className="terms-lead">
            Jean reads, sorts, and replies to your emails — so you don't have to.
          </p>

          <section className="terms-section">
            <h3>What Jean does</h3>
            <ul>
              <li>Reads and organizes your Gmail inbox by category and priority</li>
              <li>Drafts and sends emails on your behalf, always with your approval</li>
              <li>Helps you unsubscribe from promotional senders in one click</li>
            </ul>
          </section>

          <section className="terms-section">
            <h3>How your data is used</h3>
            <p>
              Jean connects to Gmail via Google's official OAuth 2.0 — it never sees your Google password.
              When you ask Jean to read or act on an email, that content is sent to{' '}
              <a href="https://www.anthropic.com" target="_blank" rel="noopener noreferrer">Anthropic's Claude API</a>{' '}
              to generate a response. Email content is <strong>not stored</strong> after your session ends.
              Your OAuth token is saved locally on this machine only so you stay logged in.
            </p>
          </section>

          <section className="terms-section">
            <h3>What Jean never does</h3>
            <ul>
              <li>Never stores your email content permanently</li>
              <li>Never shares your data with third parties</li>
              <li>Never accesses your inbox without you asking</li>
            </ul>
          </section>

          <section className="terms-section terms-section--footer">
            <p>
              By signing in, you agree to{' '}
              <a href="https://policies.google.com/terms" target="_blank" rel="noopener noreferrer">Google's Terms of Service</a>
              {' '}and{' '}
              <a href="https://www.anthropic.com/privacy" target="_blank" rel="noopener noreferrer">Anthropic's Privacy Policy</a>.
              You can revoke Jean's Gmail access anytime via your{' '}
              <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer">Google Account settings</a>.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48">
      <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"/>
      <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"/>
      <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"/>
      <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"/>
    </svg>
  );
}
