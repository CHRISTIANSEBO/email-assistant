import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import InboxLoader from './InboxLoader';
import './UnsubView.css';

export interface UnsubSender {
  name: string;
  email: string;
  domain: string;
}

interface UnsubViewProps {
  senders: UnsubSender[];
  loading: boolean;
  onUnsub: (sender: UnsubSender) => void;
}

function faviconUrl(domain: string) {
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
}

export default function UnsubView({ senders, loading, onUnsub }: UnsubViewProps) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!loading && senders.length > 0 && listRef.current) {
      gsap.fromTo(
        listRef.current.querySelectorAll('.unsub-row'),
        { opacity: 0, y: 10 },
        { opacity: 1, y: 0, duration: 0.28, stagger: 0.035, ease: 'power2.out' }
      );
    }
  }, [loading, senders.length]);

  if (loading) {
    return <InboxLoader />;
  }

  if (senders.length === 0) {
    return <div className="unsub-empty">No promotional senders found.</div>;
  }

  return (
    <div className="unsub-list" ref={listRef}>
      {senders.map(s => (
        <div key={s.email} className="unsub-row">
          <img
            className="unsub-logo"
            src={faviconUrl(s.domain)}
            alt=""
            onError={e => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }}
          />
          <div className="unsub-info">
            <span className="unsub-name">{s.name}</span>
            <span className="unsub-addr">{s.email}</span>
          </div>
          <button type="button" className="unsub-btn" onClick={() => onUnsub(s)}>
            Unsubscribe
          </button>
        </div>
      ))}
    </div>
  );
}
