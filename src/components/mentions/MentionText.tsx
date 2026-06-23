import React from 'react';
import { useDirectory } from '../../lib/mentions';

/** Renders stored note text with any "@Full Name" highlighted as a chip. */
export function MentionText({ text, style }: { text: string; style?: React.CSSProperties }) {
  const people = useDirectory();
  if (!text) return null;
  if (!text.includes('@')) return <span style={style}>{text}</span>;

  const names = people.map((p) => p.name).filter(Boolean).sort((a, b) => b.length - a.length);
  if (!names.length) return <span style={style}>{text}</span>;

  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('@(' + names.map(esc).join('|') + ')', 'g');

  const parts: React.ReactNode[] = [];
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(<span key={key++} style={chipStyle}>@{m[1]}</span>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));

  return <span style={style}>{parts}</span>;
}

const chipStyle: React.CSSProperties = {
  color: '#4338CA', background: '#EEF2FF', borderRadius: 6,
  padding: '0 4px', fontWeight: 600, whiteSpace: 'nowrap',
};
