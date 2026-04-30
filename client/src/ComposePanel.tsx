import { useState, useRef, useLayoutEffect } from 'react';
import { gsap } from 'gsap';
import './ComposePanel.css';

interface ComposePanelProps {
  open: boolean;
  onClose: () => void;
  onSend: (to: string, subject: string, body: string) => void;
}

export default function ComposePanel({ open, onClose, onSend }: ComposePanelProps) {
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const sendIconRef = useRef<SVGSVGElement>(null);
  const didMount = useRef(false);

  // Set initial off-screen position
  useLayoutEffect(() => {
    if (panelRef.current) gsap.set(panelRef.current, { y: '100%' });
    if (overlayRef.current) gsap.set(overlayRef.current, { opacity: 0, pointerEvents: 'none' });
  }, []);

  // Slide in / out on open change
  useLayoutEffect(() => {
    if (!didMount.current) { didMount.current = true; return; }
    const panel = panelRef.current;
    const overlay = overlayRef.current;
    if (!panel || !overlay) return;

    if (open) {
      gsap.to(overlay, { opacity: 1, duration: 0.25, ease: 'power2.out', pointerEvents: 'auto' });
      gsap.to(panel, { y: 0, duration: 0.42, ease: 'power3.out' });
    } else {
      gsap.to(overlay, { opacity: 0, duration: 0.22, ease: 'power2.in', pointerEvents: 'none' });
      gsap.to(panel, { y: '100%', duration: 0.3, ease: 'power3.in' });
    }
  }, [open]);

  const handleSend = () => {
    if (!to.trim()) return;

    // Paper plane fly-out on the send icon
    if (sendIconRef.current) {
      gsap.timeline()
        .to(sendIconRef.current, { x: 16, y: -16, opacity: 0, duration: 0.22, ease: 'power2.in' })
        .set(sendIconRef.current, { x: 0, y: 0, opacity: 1 });
    }

    onSend(to.trim(), subject.trim(), body.trim());
    setTo('');
    setSubject('');
    setBody('');
  };

  return (
    <div ref={overlayRef} className="compose-overlay" onClick={onClose}>
      <div ref={panelRef} className="compose-panel" onClick={e => e.stopPropagation()}>

        <div className="compose-header">
          <span className="compose-title">New Email</span>
          <button type="button" className="compose-close" onClick={onClose}>×</button>
        </div>

        <div className="compose-fields">
          <div className="compose-field">
            <label className="compose-label">To</label>
            <input
              type="email"
              className="compose-input"
              value={to}
              onChange={e => setTo(e.target.value)}
              placeholder="recipient@example.com"
              autoComplete="off"
            />
          </div>

          <div className="compose-field">
            <label className="compose-label">Subject</label>
            <input
              type="text"
              className="compose-input"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder="Subject line"
            />
          </div>

          <div className="compose-field compose-field--grow">
            <label className="compose-label">Body</label>
            <textarea
              className="compose-textarea"
              value={body}
              onChange={e => setBody(e.target.value)}
              placeholder="Write your message — Jean will review and send it."
            />
          </div>
        </div>

        <div className="compose-footer">
          <button type="button" className="compose-btn-cancel" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="compose-btn-send"
            onClick={handleSend}
            disabled={!to.trim()}
          >
            Send
            <svg ref={sendIconRef} width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M2 21l21-9L2 3v7l15 2-15 2v7z" />
            </svg>
          </button>
        </div>

      </div>
    </div>
  );
}
