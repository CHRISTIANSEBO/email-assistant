import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { gsap } from 'gsap';
import DarkVeil from './DarkVeil';
import SplitText from './SplitText';
import Sidebar from './Sidebar';
import EmailCards from './EmailCards';
import type { EmailData } from './EmailCards';
import ComposePanel from './ComposePanel';
import UnsubView from './UnsubView';
import InboxLoader from './InboxLoader';
import LoginPage from './LoginPage';
import type { UnsubSender } from './UnsubView';
import type { UserProfile } from './Sidebar';
import type { TemplateItem, RecentChat } from './StaggeredMenu';
import './App.css';

// ── Confetti ──────────────────────────────────────────────────────────────────
function triggerConfetti() {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:9999;';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) { canvas.remove(); return; }
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const colors = ['#8c50f0', '#a78bfa', '#06b6d4', '#10b981', '#f59e0b', '#ec4899', '#fff'];
  const particles = Array.from({ length: 90 }, () => ({
    x: Math.random() * canvas.width, y: Math.random() * canvas.height * 0.35 - 10,
    vx: (Math.random() - 0.5) * 5, vy: Math.random() * 3 + 1,
    color: colors[Math.floor(Math.random() * colors.length)],
    w: Math.random() * 9 + 4, h: Math.random() * 5 + 3,
    angle: Math.random() * Math.PI * 2, spin: (Math.random() - 0.5) * 0.18, opacity: 1,
  }));
  let raf: number;
  const tick = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;
    for (const p of particles) {
      p.x += p.vx; p.y += p.vy; p.vy += 0.12; p.angle += p.spin; p.opacity -= 0.007;
      if (p.opacity > 0 && p.y < canvas.height + 20) alive = true;
      ctx.save(); ctx.globalAlpha = Math.max(0, p.opacity);
      ctx.translate(p.x, p.y); ctx.rotate(p.angle);
      ctx.fillStyle = p.color; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (alive) raf = requestAnimationFrame(tick); else canvas.remove();
  };
  raf = requestAnimationFrame(tick);
  setTimeout(() => { cancelAnimationFrame(raf); canvas.remove(); }, 4500);
}

// ── Types ─────────────────────────────────────────────────────────────────────
type Message = { role: 'user' | 'assistant'; text: string; emails?: EmailData[]; quickReplies?: string[] };
type InboxView = { label: string; emails: EmailData[]; loading: boolean };
type UnsubViewState = { senders: UnsubSender[]; loading: boolean };
type Confirmation = { prompt: string };

const TOOL_LABELS: Record<string, string> = {
  read_email: 'Reading your inbox...',
  sort_emails: 'Sorting emails by priority...',
  open_email: 'Opening email...',
  send_email: 'Preparing to send...',
  summarize_email: 'Summarizing email...',
  unsubscribe_from_email: 'Processing unsubscribe...',
  save_template: 'Saving template...',
};

const QUICK_ACTIONS = ['Read inbox', 'Sort by priority', 'Check promotions', 'Unsubscribe'];

const INBOX_LABELS: Record<string, string> = {
  primary: 'Primary',
  promotions: 'Promotions',
  social: 'Social',
  updates: 'Updates',
  sort: 'Priority',
};

function parseMarkdown(text: string): string {
  function esc(s: string) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function inline(s: string) {
    return s.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  }
  const lines = text.split('\n'); const out: string[] = []; let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim().startsWith('```')) {
      const cl: string[] = []; i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) { cl.push(esc(lines[i])); i++; }
      i++; out.push(`<pre><code>${cl.join('\n')}</code></pre>`); continue;
    }
    const hm = line.match(/^(#{1,3}) (.+)/);
    if (hm) { out.push(`<h${hm[1].length}>${inline(esc(hm[2]))}</h${hm[1].length}>`); i++; continue; }
    if (/^[-*] /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*] /.test(lines[i])) { items.push(`<li>${inline(esc(lines[i].replace(/^[-*] /, '')))}</li>`); i++; }
      out.push(`<ul>${items.join('')}</ul>`); continue;
    }
    if (/^\d+\. /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\. /.test(lines[i])) { items.push(`<li>${inline(esc(lines[i].replace(/^\d+\. /, '')))}</li>`); i++; }
      out.push(`<ol>${items.join('')}</ol>`); continue;
    }
    if (line.trim() === '') { i++; continue; }
    const pl: string[] = [];
    while (i < lines.length && lines[i].trim() !== '' && !/^[-*] /.test(lines[i]) && !/^\d+\. /.test(lines[i]) && !/^#{1,3} /.test(lines[i]) && !lines[i].trim().startsWith('```')) {
      pl.push(inline(esc(lines[i]))); i++;
    }
    if (pl.length) out.push(`<p>${pl.join('<br>')}</p>`);
  }
  return out.join('');
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [messages, setMessages]               = useState<Message[]>([]);
  const [input, setInput]                     = useState('');
  const [loading, setLoading]                 = useState(false);
  const [confirmation, setConfirmation]       = useState<Confirmation | null>(null);
  const [error, setError]                     = useState<string | null>(null);
  const [chatId, setChatId]                   = useState<string | null>(null);
  const [threadId, setThreadId]               = useState<string | null>(null);
  const [recentChats, setRecentChats]         = useState<RecentChat[]>([]);
  const [streamingText, setStreamingText]     = useState('');
  const [toolStatus, setToolStatus]           = useState<string | null>(null);
  const [streamingEmails, setStreamingEmails] = useState<EmailData[]>([]);
  const [streamingQuickReplies, setStreamingQuickReplies] = useState<string[]>([]);
  const [composeOpen, setComposeOpen]         = useState(false);
  const [undoSend, setUndoSend]               = useState(false);
  const [undoCountdown, setUndoCountdown]     = useState(5);
  const [searchQuery, setSearchQuery]         = useState('');
  const [templates, setTemplates]             = useState<TemplateItem[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed]   = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [inboxView, setInboxView]                 = useState<InboxView | null>(null);
  const [unsubView, setUnsubView]               = useState<UnsubViewState | null>(null);
  const [isAuthenticated, setIsAuthenticated]   = useState<boolean | null>(null);
  const [profile, setProfile]                   = useState<UserProfile | null>(null);

  const chatIdRef       = useRef<string | null>(null);
  const threadIdRef     = useRef<string | null>(null);
  const bottomRef       = useRef<HTMLDivElement>(null);
  const inputRef        = useRef<HTMLTextAreaElement>(null);
  const abortRef        = useRef<AbortController | null>(null);
  const requestIdRef    = useRef<number>(0);
  const undoTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sidebarRef      = useRef<HTMLElement | null>(null);

  // ── Effects ──────────────────────────────────────────────────────────────

  useLayoutEffect(() => {
    if (sidebarRef.current) gsap.set(sidebarRef.current, { width: 224 });
  }, []);

  useEffect(() => {
    fetch('/auth/status')
      .then(r => r.json())
      .then(d => {
        setIsAuthenticated(d.authenticated);
        if (d.authenticated) {
          fetch('/auth/profile').then(r => r.json()).then(p => {
            if (!p.error) setProfile(p);
          }).catch(() => {});
        }
      })
      .catch(() => setIsAuthenticated(false));
  }, []);

  useEffect(() => {
    fetch('/chats').then(r => r.json()).then((d: RecentChat[]) => setRecentChats(d)).catch(() => {});
  }, []);

  useEffect(() => { chatIdRef.current = chatId; }, [chatId]);
  useEffect(() => { threadIdRef.current = threadId; }, [threadId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, confirmation, streamingText, toolStatus]);

  useEffect(() => () => {
    abortRef.current?.abort();
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    if (undoIntervalRef.current) clearInterval(undoIntervalRef.current);
  }, []);

  const signOut = async () => {
    await fetch('/auth/logout', { method: 'POST' });
    setIsAuthenticated(false);
    setProfile(null);
  };

  const fetchTemplates = () => {
    fetch('/templates').then(r => r.json()).then(setTemplates).catch(() => {});
  };
  useEffect(() => { fetchTemplates(); }, []);

  useEffect(() => {
    if (!searchQuery.trim()) {
      fetch('/chats').then(r => r.json()).then(setRecentChats).catch(() => {});
      return;
    }
    const t = setTimeout(() => {
      fetch(`/chats/search?q=${encodeURIComponent(searchQuery)}`)
        .then(r => r.json()).then(setRecentChats).catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // ── sendMessage ───────────────────────────────────────────────────────────

  const sendMessage = async (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || loading) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const myReqId = ++requestIdRef.current;

    setInboxView(null);
    setUnsubView(null);
    setMessages(prev => [...prev, { role: 'user', text: msg }]);
    setInput('');
    setLoading(true);
    setError(null);
    setStreamingText('');
    setToolStatus(null);
    setConfirmation(null);
    setStreamingEmails([]);
    setStreamingQuickReplies([]);

    // Capture snapshot of messages for the committed assistant message
    const snapshotRef = { msgs: [] as Message[] };

    let fullText = '';
    let emailListData: EmailData[] = [];
    let quickRepliesData: string[] = [];
    let streamChatId = chatIdRef.current;
    let streamThreadId = threadIdRef.current;

    // Capture current messages + new user msg for saving
    const updatedMessages: Message[] = [];

    try {
      const res = await fetch('/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg, chat_id: chatIdRef.current }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      if (!res.body) throw new Error('No response body from server.');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const readResult = await reader.read().catch(() => null);
        if (!readResult || readResult.done) break;
        buffer += decoder.decode(readResult.value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr) continue;
          let event: Record<string, unknown>;
          try { event = JSON.parse(jsonStr); } catch { continue; }
          if (requestIdRef.current !== myReqId) return;

          switch (event.type) {
            case 'start':
              streamChatId = (event.chat_id as string) ?? streamChatId;
              streamThreadId = (event.thread_id as string) ?? streamThreadId;
              if (streamChatId) { setChatId(streamChatId); chatIdRef.current = streamChatId; }
              if (streamThreadId) { setThreadId(streamThreadId); threadIdRef.current = streamThreadId; }
              break;
            case 'token':
              fullText += (event.text as string) ?? '';
              setStreamingText(fullText);
              setToolStatus(null);
              break;
            case 'tool_start':
              setToolStatus(TOOL_LABELS[event.tool as string] ?? 'Working...');
              break;
            case 'tool_done':
              setToolStatus(null);
              break;
            case 'email_list':
              emailListData = (event.emails as EmailData[]) ?? [];
              setStreamingEmails(emailListData);
              break;
            case 'quick_replies':
              quickRepliesData = (event.replies as string[]) ?? [];
              setStreamingQuickReplies(quickRepliesData);
              break;
            case 'confirmation':
              setConfirmation({ prompt: (event.prompt as string) ?? '' });
              break;
            case 'confirmation_resolved':
              setConfirmation(null);
              break;
            case 'done': {
              const finalThreadId = (event.thread_id as string) ?? streamThreadId ?? '';
              if (finalThreadId) { setThreadId(finalThreadId); threadIdRef.current = finalThreadId; }
              const assistantMsg: Message = {
                role: 'assistant', text: fullText,
                ...(emailListData.length > 0 && { emails: emailListData }),
                ...(quickRepliesData.length > 0 && { quickReplies: quickRepliesData }),
              };
              setMessages(prev => {
                const next = [...prev, assistantMsg];
                snapshotRef.msgs = next;
                return next;
              });
              setStreamingText(''); setStreamingEmails([]); setStreamingQuickReplies([]);
              setToolStatus(null); setLoading(false);
              if (streamChatId) {
                setTimeout(() => saveChat(snapshotRef.msgs, streamChatId!, finalThreadId), 0);
              }
              fetchTemplates();
              const lower = fullText.toLowerCase();
              if (lower.includes('sent successfully') || lower.includes('has been sent') ||
                  lower.includes('on its way') || lower.includes('email sent')) {
                triggerConfetti();
              }
              break;
            }
            case 'error':
              setError((event.message as string) ?? 'Something went wrong.');
              setStreamingText(''); setStreamingEmails([]); setStreamingQuickReplies([]);
              setToolStatus(null); setLoading(false);
              break;
          }
        }
      }
    } catch (e) {
      if (requestIdRef.current !== myReqId) return;
      if ((e as Error).name === 'AbortError') return;
      setError(e instanceof Error ? e.message : 'Failed to reach the server.');
      setLoading(false); setStreamingText(''); setStreamingEmails([]); setStreamingQuickReplies([]); setToolStatus(null);
    }

    void updatedMessages;
  };

  const saveChat = async (msgs: Message[], id: string, tid: string) => {
    const title = msgs.find(m => m.role === 'user')?.text.slice(0, 60) ?? 'Untitled';
    try {
      await fetch(`/chats/${id}/save`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: msgs, title, thread_id: tid }),
      });
      setRecentChats(prev => {
        const filtered = prev.filter(c => c.id !== id);
        return [{ id, title }, ...filtered].slice(0, 50);
      });
    } catch {}
  };

  // ── Confirm / undo ────────────────────────────────────────────────────────

  const handleComposeSend = (to: string, subject: string, body: string) => {
    setComposeOpen(false);
    sendMessage(`Send an email to ${to} with subject "${subject}" and the following body:\n${body}`);
  };

  const doConfirm = async (confirmed: boolean) => {
    const isEmailSend = confirmed && (confirmation?.prompt.toLowerCase().includes('send this email') ?? false);
    setConfirmation(null);
    if (isEmailSend) {
      setUndoCountdown(5); setUndoSend(true);
      undoIntervalRef.current = setInterval(() => setUndoCountdown(c => c - 1), 1000);
      undoTimerRef.current = setTimeout(async () => {
        clearInterval(undoIntervalRef.current!); setUndoSend(false);
        await fetch('/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmed: true }) });
      }, 5000);
    } else {
      try {
        await fetch('/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmed }) });
      } catch { setError('Confirmation failed.'); setLoading(false); }
    }
  };

  const handleUndo = () => {
    clearTimeout(undoTimerRef.current!); clearInterval(undoIntervalRef.current!); setUndoSend(false);
    fetch('/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmed: false }) }).catch(() => {});
  };

  // ── Chat management ───────────────────────────────────────────────────────

  const clearChat = () => {
    abortRef.current?.abort();
    setMessages([]); setConfirmation(null); setLoading(false); setInput(''); setError(null);
    setChatId(null); setThreadId(null); setStreamingText(''); setStreamingEmails([]);
    setStreamingQuickReplies([]); setToolStatus(null);
    setInboxView(null); setUnsubView(null);
    chatIdRef.current = null; threadIdRef.current = null;
  };

  const newChat = () => {
    clearChat();
    setInboxView(null);
    inputRef.current?.focus();
  };

  function parseSender(raw: string): UnsubSender {
    const match = raw.match(/^"?([^"<]+?)"?\s*<([^>]+)>$/);
    const email = match ? match[2].trim() : raw.trim();
    const rawName = match ? match[1].trim().replace(/^"|"$/g, '') : '';
    const fullDomain = email.split('@')[1] ?? '';
    const parts = fullDomain.split('.');
    const domain = parts.length > 2 ? parts.slice(-2).join('.') : fullDomain;
    const name = rawName || domain;
    return { name, email, domain };
  }

  const fetchInbox = async (category: string) => {
    if (category === 'unsub') {
      clearChat();
      setUnsubView({ senders: [], loading: true });
      try {
        const res = await fetch('/inbox?category=promotions');
        if (!res.ok) throw new Error(`Server error ${res.status}`);
        const emails: EmailData[] = await res.json();
        const seen = new Set<string>();
        const senders: UnsubSender[] = [];
        for (const e of emails) {
          const s = parseSender(e.sender);
          if (s.domain && !seen.has(s.domain)) { seen.add(s.domain); senders.push(s); }
        }
        senders.sort((a, b) => a.name.localeCompare(b.name));
        setUnsubView({ senders, loading: false });
      } catch (e) {
        setUnsubView(null);
        setError(e instanceof Error ? e.message : 'Failed to load senders.');
      }
      return;
    }
    clearChat();
    setInboxView({ label: INBOX_LABELS[category] ?? category, emails: [], loading: true });
    try {
      const url = category === 'sort' ? '/inbox?sort=priority' : `/inbox?category=${category}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data = await res.json();
      if (Array.isArray(data)) {
        setInboxView({ label: INBOX_LABELS[category] ?? category, emails: data, loading: false });
      } else {
        throw new Error((data as { error?: string }).error ?? 'Failed to load inbox.');
      }
    } catch (e) {
      setInboxView(null);
      setError(e instanceof Error ? e.message : 'Failed to load inbox.');
    }
  };

  const loadChat = async (id: string) => {
    try {
      const res = await fetch(`/chats/${id}`);
      if (!res.ok) return;
      const data = await res.json();
      setMessages(data.messages ?? []); setChatId(id); setThreadId(data.thread_id ?? null);
      chatIdRef.current = id; threadIdRef.current = data.thread_id ?? null;
      setConfirmation(null); setError(null); setStreamingText(''); setStreamingEmails([]);
      setStreamingQuickReplies([]); setToolStatus(null);
    } catch { setError('Failed to load chat.'); }
  };

  const deleteChat = async (id: string) => {
    try {
      await fetch(`/chats/${id}`, { method: 'DELETE' });
      setRecentChats(prev => prev.filter(c => c.id !== id));
      if (chatIdRef.current === id) newChat();
    } catch {}
  };

  const useTemplate = (t: TemplateItem) => {
    sendMessage(`Use my "${t.name}" template — send an email with subject "${t.subject}" and body: ${t.body}`);
  };

  const deleteTemplate = async (id: string) => {
    try {
      await fetch(`/templates/${id}`, { method: 'DELETE' });
      setTemplates(prev => prev.filter(t => t.id !== id));
    } catch {}
  };

  const isEmpty = messages.length === 0 && !loading && !streamingText && streamingEmails.length === 0 && inboxView === null && unsubView === null;

  if (isAuthenticated === null) return null;
  if (!isAuthenticated) return <LoginPage />;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="app-layout">
      <ComposePanel open={composeOpen} onClose={() => setComposeOpen(false)} onSend={handleComposeSend} />

      {mobileSidebarOpen && (
        <div className="sidebar-overlay" onClick={() => setMobileSidebarOpen(false)} aria-hidden="true" />
      )}

      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(c => !c)}
        mobileOpen={mobileSidebarOpen}
        onFetchInbox={(cat) => { fetchInbox(cat); setMobileSidebarOpen(false); }}
        onCompose={() => { setComposeOpen(true); setMobileSidebarOpen(false); }}
        profile={profile}
        onSignOut={signOut}
        templates={templates}
        onUseTemplate={(t) => { useTemplate(t); setMobileSidebarOpen(false); }}
        onDeleteTemplate={deleteTemplate}
        recentChats={recentChats}
        onLoadChat={(id) => { loadChat(id); setMobileSidebarOpen(false); }}
        onDeleteChat={deleteChat}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onNewChat={() => { newChat(); setMobileSidebarOpen(false); }}
      />

      <main className="main">
        <div className="main-bg">
          <DarkVeil speed={0.5} />
        </div>

        <div className="chat-area">
          <button
            type="button"
            className="mobile-menu-btn"
            onClick={() => setMobileSidebarOpen(o => !o)}
            aria-label="Open menu"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
            </svg>
          </button>

          {isEmpty ? (
            <div className="greeting">
              <SplitText
                text="Hi, I'm Jean"
                tag="h1"
                className="greeting-title"
                delay={40} duration={1.2} ease="power3.out" splitType="chars"
                from={{ opacity: 0, y: 30 }} to={{ opacity: 1, y: 0 }}
                threshold={0} rootMargin="0px" textAlign="center"
              />
              <div className="input-box input-greeting">
                <div className="input-wrapper">
                  <textarea
                    ref={inputRef}
                    className="chat-input"
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                    placeholder="Message Jean..."
                    disabled={loading}
                    rows={1}
                  />
                  <button type="button" className="send-btn" onClick={() => sendMessage()} disabled={loading || !input.trim()} aria-label="Send">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M2 21l21-9L2 3v7l15 2-15 2v7z"/></svg>
                  </button>
                </div>
                <div className="quick-actions">
                  {QUICK_ACTIONS.map(a => (
                    <button key={a} type="button" className="quick-action-btn" onClick={() => sendMessage(a)}>{a}</button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <>
              {unsubView ? (
                <div className="inbox-view">
                  <div className="inbox-view-hdr">
                    <span className="inbox-view-label">Unsubscribe</span>
                    {!unsubView.loading && (
                      <span className="inbox-view-count">
                        {unsubView.senders.length > 0 ? `${unsubView.senders.length} senders` : 'None found'}
                      </span>
                    )}
                  </div>
                  <UnsubView
                    senders={unsubView.senders}
                    loading={unsubView.loading}
                    onUnsub={s => {
                      setUnsubView(null);
                      sendMessage(`Unsubscribe me from ${s.name} <${s.email}>`);
                    }}
                  />
                </div>
              ) : inboxView ? (
                <div className="inbox-view">
                  <div className="inbox-view-hdr">
                    <span className="inbox-view-label">{inboxView.label}</span>
                    {!inboxView.loading && (
                      <span className="inbox-view-count">
                        {inboxView.emails.length > 0 ? `${inboxView.emails.length} emails` : 'Nothing here'}
                      </span>
                    )}
                  </div>
                  {inboxView.loading ? (
                    <InboxLoader />
                  ) : inboxView.emails.length > 0 ? (
                    <EmailCards emails={inboxView.emails} onAction={sendMessage} />
                  ) : (
                    <div className="inbox-view-empty">You're all caught up.</div>
                  )}
                </div>
              ) : (
              <div className="messages">
                {messages.map((m, i) => (
                  <div key={`${m.role}-${i}`} className={`message ${m.role}${m.emails?.length ? ' has-cards' : ''}`}>
                    {m.role === 'assistant' ? (
                      <>
                        {m.emails && m.emails.length > 0 ? (
                          <div className="message-text-wrap">
                            <span dangerouslySetInnerHTML={{ __html: parseMarkdown(m.text) }} />
                          </div>
                        ) : (
                          <span dangerouslySetInnerHTML={{ __html: parseMarkdown(m.text) }} />
                        )}
                        {m.emails && m.emails.length > 0 && <EmailCards emails={m.emails} onAction={sendMessage} />}
                        {m.quickReplies && m.quickReplies.length > 0 && (
                          <div className="quick-reply-chips">
                            {m.quickReplies.map((r, ri) => (
                              <button key={ri} type="button" className="quick-reply-chip" onClick={() => sendMessage(r)}>{r}</button>
                            ))}
                          </div>
                        )}
                      </>
                    ) : m.text}
                  </div>
                ))}

                {toolStatus && !streamingText && (
                  <div className="message assistant typing-msg">
                    <span className="tool-status-text">{toolStatus}</span>
                  </div>
                )}

                {(streamingText || streamingEmails.length > 0 || streamingQuickReplies.length > 0) && (
                  <div className={`message assistant${streamingEmails.length > 0 ? ' has-cards' : ''}`}>
                    {streamingText && streamingEmails.length > 0 ? (
                      <div className="message-text-wrap">
                        <span dangerouslySetInnerHTML={{ __html: parseMarkdown(streamingText) }} />
                        <span className="streaming-cursor" aria-hidden="true" />
                      </div>
                    ) : streamingText ? (
                      <><span dangerouslySetInnerHTML={{ __html: parseMarkdown(streamingText) }} /><span className="streaming-cursor" aria-hidden="true" /></>
                    ) : null}
                    {streamingEmails.length > 0 && <EmailCards emails={streamingEmails} onAction={sendMessage} />}
                    {streamingQuickReplies.length > 0 && (
                      <div className="quick-reply-chips">
                        {streamingQuickReplies.map((r, ri) => (
                          <button key={ri} type="button" className="quick-reply-chip" onClick={() => sendMessage(r)}>{r}</button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {undoSend && (
                  <div className="undo-toast">
                    <span>Sending in {undoCountdown}s</span>
                    <button type="button" className="undo-btn" onClick={handleUndo}>Undo</button>
                  </div>
                )}

                {loading && !streamingText && !toolStatus && (
                  <div className="message assistant typing-msg">
                    <span className="typing-dot" /><span className="typing-dot" /><span className="typing-dot" />
                  </div>
                )}

                {confirmation && (
                  <div className="confirm-card">
                    <p className="confirm-prompt">{confirmation.prompt}</p>
                    <div className="confirm-buttons">
                      <button type="button" className="btn-allow" onClick={() => doConfirm(true)}>Allow</button>
                      <button type="button" className="btn-deny" onClick={() => doConfirm(false)}>Deny</button>
                    </div>
                  </div>
                )}

                {error && <div className="message assistant" style={{ color: 'rgba(240,100,100,0.9)' }}>{error}</div>}
                <div ref={bottomRef} />
              </div>
              )}

              <div className="input-box">
                <div className="input-wrapper">
                  <textarea
                    ref={inputRef}
                    className="chat-input"
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                    placeholder="Message Jean..."
                    disabled={loading}
                    rows={1}
                  />
                  <button type="button" className="send-btn" onClick={() => sendMessage()} disabled={loading || !input.trim()} aria-label="Send">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M2 21l21-9L2 3v7l15 2-15 2v7z"/></svg>
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
