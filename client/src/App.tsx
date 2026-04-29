import { useState, useRef, useEffect } from 'react';
import DarkVeil from './DarkVeil';
import SplitText from './SplitText';
import StaggeredMenu from './StaggeredMenu';
import type { StaggeredMenuItem, StaggeredMenuSocialItem, RecentChat } from './StaggeredMenu';
import './App.css';

type Message = { role: 'user' | 'assistant'; text: string };
type Confirmation = { prompt: string };

const TOOL_LABELS: Record<string, string> = {
  read_email: 'Reading your inbox...',
  sort_emails: 'Sorting emails by priority...',
  open_email: 'Opening email...',
  send_email: 'Preparing to send...',
  summarize_email: 'Summarizing email...',
  unsubscribe_from_email: 'Processing unsubscribe...',
};

const QUICK_ACTIONS = ['Read inbox', 'Sort by priority', 'Check promotions', 'Unsubscribe'];

function parseMarkdown(text: string): string {
  function esc(s: string) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function inline(s: string) {
    return s
      .replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  }
  const lines = text.split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim().startsWith('```')) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(esc(lines[i])); i++;
      }
      i++;
      out.push(`<pre><code>${codeLines.join('\n')}</code></pre>`);
      continue;
    }
    const hMatch = line.match(/^(#{1,3}) (.+)/);
    if (hMatch) {
      out.push(`<h${hMatch[1].length}>${inline(esc(hMatch[2]))}</h${hMatch[1].length}>`);
      i++; continue;
    }
    if (/^[-*] /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*] /.test(lines[i])) {
        items.push(`<li>${inline(esc(lines[i].replace(/^[-*] /, '')))}</li>`); i++;
      }
      out.push(`<ul>${items.join('')}</ul>`); continue;
    }
    if (/^\d+\. /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\. /.test(lines[i])) {
        items.push(`<li>${inline(esc(lines[i].replace(/^\d+\. /, '')))}</li>`); i++;
      }
      out.push(`<ol>${items.join('')}</ol>`); continue;
    }
    if (line.trim() === '') { i++; continue; }
    const paraLines: string[] = [];
    while (
      i < lines.length && lines[i].trim() !== '' &&
      !/^[-*] /.test(lines[i]) && !/^\d+\. /.test(lines[i]) &&
      !/^#{1,3} /.test(lines[i]) && !lines[i].trim().startsWith('```')
    ) {
      paraLines.push(inline(esc(lines[i]))); i++;
    }
    if (paraLines.length) out.push(`<p>${paraLines.join('<br>')}</p>`);
  }
  return out.join('');
}

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chatId, setChatId] = useState<string | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [recentChats, setRecentChats] = useState<RecentChat[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [toolStatus, setToolStatus] = useState<string | null>(null);

  const chatIdRef = useRef<string | null>(null);
  const threadIdRef = useRef<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef<number>(0);

  useEffect(() => {
    fetch('/chats')
      .then(r => r.json())
      .then((data: RecentChat[]) => setRecentChats(data))
      .catch(() => {});
  }, []);

  useEffect(() => { chatIdRef.current = chatId; }, [chatId]);
  useEffect(() => { threadIdRef.current = threadId; }, [threadId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, confirmation, streamingText, toolStatus]);

  // Cancel any in-flight stream on unmount
  useEffect(() => () => { abortRef.current?.abort(); }, []);

  const saveChat = async (msgs: Message[], id: string, tid: string) => {
    const title = msgs.find(m => m.role === 'user')?.text.slice(0, 60) ?? 'Untitled';
    try {
      await fetch(`/chats/${id}/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: msgs, title, thread_id: tid }),
      });
      setRecentChats(prev => {
        const filtered = prev.filter(c => c.id !== id);
        return [{ id, title }, ...filtered].slice(0, 50);
      });
    } catch {
      // Non-critical — chat still works without persistence
    }
  };

  const sendMessage = async (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || loading) return;

    // Cancel any previous in-flight stream
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const myReqId = ++requestIdRef.current;

    const userMsg: Message = { role: 'user', text: msg };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setInput('');
    setLoading(true);
    setError(null);
    setStreamingText('');
    setToolStatus(null);
    setConfirmation(null);

    let fullText = '';
    let streamChatId = chatIdRef.current;
    let streamThreadId = threadIdRef.current;

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

          // Discard events from a superseded request
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

            case 'confirmation':
              setConfirmation({ prompt: (event.prompt as string) ?? '' });
              break;

            case 'confirmation_resolved':
              setConfirmation(null);
              break;

            case 'done': {
              const finalThreadId = (event.thread_id as string) ?? streamThreadId ?? '';
              if (finalThreadId) { setThreadId(finalThreadId); threadIdRef.current = finalThreadId; }
              const assistantMsg: Message = { role: 'assistant', text: fullText };
              const finalMessages = [...updatedMessages, assistantMsg];
              setMessages(finalMessages);
              setStreamingText('');
              setToolStatus(null);
              setLoading(false);
              if (streamChatId) saveChat(finalMessages, streamChatId, finalThreadId);
              break;
            }

            case 'error':
              setError((event.message as string) ?? 'Something went wrong.');
              setStreamingText('');
              setToolStatus(null);
              setLoading(false);
              break;
          }
        }
      }
    } catch (e) {
      if (requestIdRef.current !== myReqId) return;
      if ((e as Error).name === 'AbortError') return;
      setError(e instanceof Error ? e.message : 'Failed to reach the server.');
      setLoading(false);
      setStreamingText('');
      setToolStatus(null);
    }
  };

  // In streaming mode /confirm just unblocks the agent; the SSE stream delivers the rest
  const doConfirm = async (confirmed: boolean) => {
    setConfirmation(null);
    try {
      await fetch('/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmed }),
      });
    } catch {
      setError('Confirmation failed.');
      setLoading(false);
    }
  };

  const newChat = () => {
    abortRef.current?.abort();
    setMessages([]);
    setConfirmation(null);
    setLoading(false);
    setInput('');
    setError(null);
    setChatId(null);
    setThreadId(null);
    setStreamingText('');
    setToolStatus(null);
    chatIdRef.current = null;
    threadIdRef.current = null;
    inputRef.current?.focus();
  };

  const loadChat = async (id: string) => {
    try {
      const res = await fetch(`/chats/${id}`);
      if (!res.ok) return;
      const data = await res.json();
      setMessages(data.messages ?? []);
      setChatId(id);
      setThreadId(data.thread_id ?? null);
      chatIdRef.current = id;
      threadIdRef.current = data.thread_id ?? null;
      setConfirmation(null);
      setError(null);
      setStreamingText('');
      setToolStatus(null);
    } catch {
      setError('Failed to load chat.');
    }
  };

  const deleteChat = async (id: string) => {
    try {
      await fetch(`/chats/${id}`, { method: 'DELETE' });
      setRecentChats(prev => prev.filter(c => c.id !== id));
      if (chatIdRef.current === id) newChat();
    } catch {}
  };

  const isEmpty = messages.length === 0 && !loading && !streamingText;

  const menuItems: StaggeredMenuItem[] = [
    { label: 'New Chat',    ariaLabel: 'Start a new chat',        onClick: newChat },
    { label: 'Primary',     ariaLabel: 'Read primary inbox',      onClick: () => sendMessage('Read my primary inbox') },
    { label: 'Promotions',  ariaLabel: 'Read promotions inbox',   onClick: () => sendMessage('Read my promotions') },
    { label: 'Social',      ariaLabel: 'Read social inbox',       onClick: () => sendMessage('Read my social inbox') },
    { label: 'Sort',        ariaLabel: 'Sort emails by priority', onClick: () => sendMessage('Sort my emails by priority') },
    { label: 'Send',        ariaLabel: 'Compose and send email',  onClick: () => sendMessage('I want to send an email') },
    { label: 'Unsubscribe', ariaLabel: 'Unsubscribe from sender', onClick: () => sendMessage('Help me unsubscribe from a sender') },
  ];

  const socialItems: StaggeredMenuSocialItem[] = [];

  return (
    <div className="app">
      <StaggeredMenu
        isFixed
        position="left"
        items={menuItems}
        socialItems={socialItems}
        displaySocials
        displayItemNumbering
        colors={['#2d1a4a', '#1a0d2e']}
        accentColor="#8c50f0"
        menuButtonColor="rgba(255,255,255,0.7)"
        openMenuButtonColor="rgba(255,255,255,0.95)"
        recentChats={recentChats}
        onLoadChat={loadChat}
        onDeleteChat={deleteChat}
      />

      <main className="main">
        <div className="main-bg">
          <DarkVeil speed={0.5} />
        </div>

        <div className="chat-area">
          {isEmpty ? (
            <div className="greeting">
              <SplitText
                text="Hi, I'm Jean"
                tag="h1"
                className="greeting-title"
                delay={40}
                duration={1.2}
                ease="power3.out"
                splitType="chars"
                from={{ opacity: 0, y: 30 }}
                to={{ opacity: 1, y: 0 }}
                threshold={0}
                rootMargin="0px"
                textAlign="center"
              />
              <div className="input-box input-greeting">
                <div className="input-wrapper">
                  <textarea
                    ref={inputRef}
                    className="chat-input"
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
                    }}
                    placeholder="Message Jean..."
                    disabled={loading}
                    rows={1}
                  />
                  <button
                    type="button"
                    className="send-btn"
                    onClick={() => sendMessage()}
                    disabled={loading || !input.trim()}
                    aria-label="Send"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M2 21l21-9L2 3v7l15 2-15 2v7z"/>
                    </svg>
                  </button>
                </div>
                <div className="quick-actions">
                  {QUICK_ACTIONS.map(a => (
                    <button key={a} type="button" className="quick-action-btn" onClick={() => sendMessage(a)}>
                      {a}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="messages">
                {messages.map((m, i) => (
                  <div key={`${m.role}-${i}`} className={`message ${m.role}`}>
                    {m.role === 'assistant'
                      ? <span dangerouslySetInnerHTML={{ __html: parseMarkdown(m.text) }} />
                      : m.text}
                  </div>
                ))}

                {/* Tool activity indicator */}
                {toolStatus && !streamingText && (
                  <div className="message assistant typing-msg">
                    <span className="tool-status-text">{toolStatus}</span>
                  </div>
                )}

                {/* Live streaming response */}
                {streamingText && (
                  <div className="message assistant">
                    <span dangerouslySetInnerHTML={{ __html: parseMarkdown(streamingText) }} />
                    <span className="streaming-cursor" aria-hidden="true" />
                  </div>
                )}

                {/* Initial thinking dots — shown before first token or tool event */}
                {loading && !streamingText && !toolStatus && (
                  <div className="message assistant typing-msg">
                    <span className="typing-dot" />
                    <span className="typing-dot" />
                    <span className="typing-dot" />
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

                {error && (
                  <div className="message assistant" style={{ color: 'rgba(240,100,100,0.9)' }}>
                    {error}
                  </div>
                )}

                <div ref={bottomRef} />
              </div>

              <div className="input-box">
                <div className="input-wrapper">
                  <textarea
                    ref={inputRef}
                    className="chat-input"
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
                    }}
                    placeholder="Message Jean..."
                    disabled={loading}
                    rows={1}
                  />
                  <button
                    type="button"
                    className="send-btn"
                    onClick={() => sendMessage()}
                    disabled={loading || !input.trim()}
                    aria-label="Send"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M2 21l21-9L2 3v7l15 2-15 2v7z"/>
                    </svg>
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
