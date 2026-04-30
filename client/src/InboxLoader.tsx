import { useState, useEffect } from 'react';
import './InboxLoader.css';

const WORDS = [
  'Fetching',
  'Gathering',
  'Scanning',
  'Sorting',
  'Organizing',
  'Reading through',
  'Pulling these in',
  'Checking',
  'On it',
  'Almost there',
];

export default function InboxLoader() {
  const [wordIdx, setWordIdx] = useState(() => Math.floor(Math.random() * WORDS.length));
  const [visible, setVisible] = useState(true);
  const [dots, setDots] = useState('.');

  useEffect(() => {
    const t = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setWordIdx(prev => {
          let next = Math.floor(Math.random() * WORDS.length);
          while (next === prev) next = Math.floor(Math.random() * WORDS.length);
          return next;
        });
        setVisible(true);
      }, 280);
    }, 1600);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      setDots(d => d.length >= 3 ? '.' : d + '.');
    }, 380);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="inbox-loader">
      <div className="inbox-loader-orb" />
      <span className={`inbox-loader-word${visible ? '' : ' out'}`}>
        {WORDS[wordIdx]}<span className="inbox-loader-dots">{dots}</span>
      </span>
    </div>
  );
}
