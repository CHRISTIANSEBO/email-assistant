import { useState, useRef, useEffect } from 'react';
import { gsap } from 'gsap';
import './EmailCards.css';

export interface AttachmentData {
  name: string;
  mimeType: string;
  size: number;
}

export interface EmailData {
  subject: string;
  sender: string;
  priority?: number;
  attachments?: AttachmentData[];
}

interface EmailCardsProps {
  emails: EmailData[];
  onAction: (message: string) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function parseSender(sender: string): { name: string; email: string } {
  const match = sender.match(/^(.+?)\s*<([^>]+)>/);
  if (match) return { name: match[1].trim(), email: match[2].trim() };
  const email = sender.trim();
  const username = email.split('@')[0] ?? email;
  const name = username.charAt(0).toUpperCase() + username.slice(1).replace(/[._-]+/g, ' ');
  return { name, email };
}

function getRootDomain(email: string): string {
  const full = email.split('@')[1] ?? '';
  const parts = full.split('.');
  return parts.length > 2 ? parts.slice(-2).join('.') : full;
}

function avatarColor(seed: string): string {
  const palette = ['#6366f1', '#8b5cf6', '#a855f7', '#06b6d4', '#10b981', '#f59e0b'];
  let hash = 0;
  for (const c of seed) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
  return palette[Math.abs(hash) % palette.length];
}

type Category = 'primary' | 'promotions' | 'social' | 'urgent';

function getCategory(email: EmailData): Category {
  if ((email.priority ?? 0) > 0) return 'urgent';
  const s = email.subject.toLowerCase();
  if (/\b(deal|off|discount|sale|promo|offer|free|save|buy|shop|%|newsletter)\b/.test(s)) return 'promotions';
  if (/\b(follower|mentioned|liked|friend|connection|invitation|request)\b/.test(s)) return 'social';
  return 'primary';
}

const CATEGORY_COLOR: Record<Category, string> = {
  primary:    '#8c50f0',
  promotions: '#f59e0b',
  social:     '#06b6d4',
  urgent:     '#ef4444',
};

// ── Single card ───────────────────────────────────────────────────────────

function EmailCard({
  email, index, isSelected, onToggleSelect, onAction,
}: {
  email: EmailData;
  index: number;
  isSelected: boolean;
  onToggleSelect: () => void;
  onAction: (msg: string) => void;
}) {
  const [imgError, setImgError]   = useState(false);
  const [expanded, setExpanded]   = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyText, setReplyText] = useState('');

  const { name, email: addr } = parseSender(email.sender);
  const domain   = getRootDomain(addr);
  const initial  = (name[0] ?? '?').toUpperCase();
  const color    = avatarColor(addr);
  const category = getCategory(email);

  const toggleExpand = () => { if (!replyOpen) setExpanded(e => !e); };

  const handleReply = (e: React.MouseEvent) => {
    e.stopPropagation();
    setReplyOpen(r => !r);
    setExpanded(false);
  };

  const submitReply = () => {
    if (!replyText.trim()) return;
    onAction(`Reply to the email from ${addr} with this message: ${replyText.trim()}`);
    setReplyText('');
    setReplyOpen(false);
  };

  return (
    <div
      className={`email-card${expanded ? ' email-card--expanded' : ''}${isSelected ? ' email-card--selected' : ''}${expanded || replyOpen ? ' email-card--wide' : ''}`}
      style={{ '--cat': CATEGORY_COLOR[category] } as React.CSSProperties}
    >
      {/* ── Main row ── */}
      <div className="email-card-row" onClick={toggleExpand}>

        <label className="email-card-check" onClick={e => e.stopPropagation()}>
          <input type="checkbox" checked={isSelected} onChange={onToggleSelect} aria-label={`Select email from ${name}`} />
          <span className="ec-checkmark" />
        </label>

        <span className="email-card-idx">{index + 1}</span>

        <div className="email-card-avatar">
          {!imgError && domain ? (
            <img
              className="email-card-logo"
              src={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`}
              alt={name}
              onError={() => setImgError(true)}
            />
          ) : (
            <div className="email-card-initial" style={{ background: color }}>{initial}</div>
          )}
        </div>

        <div className="email-card-body">
          <span className="email-card-name">{name}</span>
          <span className="email-card-subject">{email.subject}</span>
          {email.attachments && email.attachments.length > 0 && (
            <div className="email-card-attachments">
              {email.attachments.map((a, i) => (
                <span key={i} className="email-attachment-chip" title={`${Math.round(a.size / 1024)} KB`}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round"/>
                  </svg>
                  {a.name.length > 18 ? a.name.slice(0, 16) + '…' : a.name}
                </span>
              ))}
            </div>
          )}
        </div>

        {(category === 'urgent' || category === 'promotions') && (
          <span className={`email-card-badge email-card-badge--${category}`}>
            {category === 'urgent' ? 'urgent' : 'promo'}
          </span>
        )}

        <div className="email-card-actions" onClick={e => e.stopPropagation()}>
          <button type="button" className="email-action-btn"
            onClick={() => onAction(`Open the email from ${addr}`)}>Open</button>
          <button type="button" className="email-action-btn" onClick={handleReply}>Reply</button>
          <button type="button" className="email-action-btn email-action-unsub"
            onClick={() => onAction(`Unsubscribe from ${addr}`)}>Unsub</button>
        </div>
      </div>

      {/* ── Expanded detail ── */}
      {expanded && (
        <div className="email-card-detail">
          <span className="email-card-addr">{addr}</span>
          <button type="button" className="email-read-btn"
            onClick={() => onAction(`Open the email from ${addr}`)}>
            Read full email →
          </button>
        </div>
      )}

      {/* ── Inline reply ── */}
      {replyOpen && (
        <div className="email-reply-box" onClick={e => e.stopPropagation()}>
          <textarea
            className="email-reply-input"
            value={replyText}
            onChange={e => setReplyText(e.target.value)}
            placeholder={`Reply to ${name}...`}
            rows={3}
            autoFocus
          />
          <div className="email-reply-footer">
            <button type="button" className="email-reply-cancel" onClick={() => setReplyOpen(false)}>Cancel</button>
            <button type="button" className="email-reply-send" disabled={!replyText.trim()} onClick={submitReply}>
              Send reply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Container ─────────────────────────────────────────────────────────────

export default function EmailCards({ emails, onAction }: EmailCardsProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const [selectedSet, setSelectedSet] = useState<Set<number>>(new Set());

  // Staggered entrance
  useEffect(() => {
    const cards = Array.from(listRef.current?.querySelectorAll('.email-card') ?? []);
    if (!cards.length) return;
    gsap.set(cards, { opacity: 0, y: 12 });
    gsap.to(cards, { opacity: 1, y: 0, duration: 0.32, ease: 'power2.out', stagger: 0.055 });
  }, [emails]);

  const toggle = (i: number) => setSelectedSet(prev => {
    const next = new Set(prev);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    return next;
  });

  const bulkUnsub = () => {
    const addrs = [...selectedSet].map(i => parseSender(emails[i].sender).email).join(', ');
    onAction(`Unsubscribe me from all of these senders: ${addrs}`);
    setSelectedSet(new Set());
  };

  return (
    <div className="email-cards-wrap">
      <div ref={listRef} className="email-cards">
        {emails.map((e, i) => (
          <EmailCard
            key={i} email={e} index={i}
            isSelected={selectedSet.has(i)}
            onToggleSelect={() => toggle(i)}
            onAction={onAction}
          />
        ))}
      </div>

      {selectedSet.size > 0 && (
        <div className="email-bulk-bar">
          <span className="email-bulk-count">{selectedSet.size} selected</span>
          <button type="button" className="email-bulk-unsub" onClick={bulkUnsub}>
            Unsubscribe all
          </button>
          <button type="button" className="email-bulk-clear" onClick={() => setSelectedSet(new Set())}>
            Clear
          </button>
        </div>
      )}
    </div>
  );
}
