import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDirectory, extractMentionIds, type TaggablePerson } from '../../lib/mentions';

/**
 * A drop-in <textarea> that pops a Teams-style autocomplete when the user
 * types "@". Selecting a person inserts "@Full Name" and reports the tagged
 * profile ids via onMentionsChange. The suggestion list renders in a portal
 * anchored to the textarea, so it is never clipped by scrollable panels,
 * modals, or overflow-hidden tables — and it flips above the field when there
 * isn't room below.
 */

const baseStyle: React.CSSProperties = {
  width: '100%', padding: '9px 14px', border: '1px solid #E2E8F0',
  borderRadius: 12, fontSize: 13, color: '#0F172A', background: '#F8FAFC',
  outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
  resize: 'vertical', minHeight: 72, lineHeight: 1.5,
};

// Matches the in-progress "@query" immediately before the caret. The query
// ends at a newline or a second "@", and is capped so a stray "@" mid-text
// doesn't open the menu against the whole rest of the paragraph.
const MENTION_RE = /@([^\n@]{0,40})$/;
const MENU_MAX_H = 260;

interface Props {
  value: string;
  onChange: (value: string) => void;
  onMentionsChange?: (ids: string[]) => void;
  placeholder?: string;
  rows?: number;
  autoFocus?: boolean;
  style?: React.CSSProperties;
  /** When provided, the field uses this class instead of the built-in inline look. */
  className?: string;
  /** People to omit from suggestions (e.g. the current user). */
  excludeIds?: string[];
}

export function MentionTextarea({
  value, onChange, onMentionsChange, placeholder, rows, autoFocus, style, className, excludeIds,
}: Props) {
  const people = useDirectory();
  const taggable = excludeIds?.length ? people.filter((p) => !excludeIds.includes(p.id)) : people;

  const ref = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [anchor, setAnchor] = useState<{ left: number; top: number; width: number; flip: boolean } | null>(null);
  const caretRef = useRef<number | null>(null);

  const matches = query == null ? [] : taggable.filter((p) => {
    const q = query.toLowerCase();
    return p.name.toLowerCase().includes(q) || p.roleLabel.toLowerCase().includes(q);
  }).slice(0, 6);

  const showMenu = query != null && matches.length > 0;

  // Position the portal menu against the textarea; flip above if no room below.
  // The menu only renders when `showMenu && anchor`, so a stale anchor while
  // the menu is closed is harmless (no synchronous reset needed).
  useLayoutEffect(() => {
    if (!showMenu) return;
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      const spaceBelow = window.innerHeight - r.bottom;
      const flip = spaceBelow < MENU_MAX_H + 16 && r.top > spaceBelow;
      setAnchor({ left: r.left, top: flip ? r.top : r.bottom, width: r.width, flip });
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [showMenu, value]);

  // Restore the caret after an inserted mention re-renders the value.
  useEffect(() => {
    if (caretRef.current != null && ref.current) {
      ref.current.selectionStart = ref.current.selectionEnd = caretRef.current;
      caretRef.current = null;
    }
  });

  function detect(text: string, caret: number) {
    const m = text.slice(0, caret).match(MENTION_RE);
    if (m) { setQuery(m[1]); setActive(0); } else { setQuery(null); }
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const v = e.target.value;
    onChange(v);
    onMentionsChange?.(extractMentionIds(v, people));
    detect(v, e.target.selectionStart ?? v.length);
  }

  function handleSelectClick(text: string, caret: number) {
    // Re-detect after click navigation (caret may have moved).
    detect(text, caret);
  }

  function select(p: TaggablePerson) {
    const el = ref.current;
    if (!el) return;
    const caret = el.selectionStart ?? value.length;
    const before = value.slice(0, caret);
    const after = value.slice(caret);
    const atIdx = before.lastIndexOf('@');
    if (atIdx < 0) return;
    const newBefore = before.slice(0, atIdx) + '@' + p.name + ' ';
    const newValue = newBefore + after;
    caretRef.current = newBefore.length;
    onChange(newValue);
    onMentionsChange?.(extractMentionIds(newValue, people));
    setQuery(null);
    requestAnimationFrame(() => el.focus());
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!showMenu) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % matches.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a - 1 + matches.length) % matches.length); }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); select(matches[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); setQuery(null); }
  }

  const menu = showMenu && anchor ? createPortal(
    <div
      style={{
        position: 'fixed',
        left: anchor.left,
        top: anchor.flip ? undefined : anchor.top + 4,
        bottom: anchor.flip ? window.innerHeight - anchor.top + 4 : undefined,
        width: Math.max(220, Math.min(anchor.width, 360)),
        zIndex: 9999,
        background: '#fff', borderRadius: 12, border: '1px solid #E2E8F0',
        boxShadow: '0 12px 32px rgba(15,23,42,0.18)', padding: 4,
        maxHeight: MENU_MAX_H, overflowY: 'auto',
      }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <div style={hintStyle}>↑↓ to navigate · enter to tag</div>
      {matches.map((p, i) => (
        <button
          key={p.id}
          type="button"
          onMouseDown={(e) => { e.preventDefault(); select(p); }}
          onMouseEnter={() => setActive(i)}
          style={{ ...itemStyle, background: i === active ? '#F1F5F9' : 'transparent' }}
        >
          <span style={avatarStyle}>{p.initials}</span>
          <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', minWidth: 0 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#0F172A' }}>{p.name}</span>
            <span style={{ fontSize: 11, color: '#94A3B8' }}>{p.roleLabel}{p.plant ? ' · ' + p.plant : ''}</span>
          </span>
        </button>
      ))}
    </div>,
    document.body,
  ) : null;

  return (
    <div style={{ position: 'relative' }}>
      <textarea
        ref={ref}
        value={value}
        rows={rows}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={handleChange}
        onKeyDown={handleKey}
        onClick={(e) => handleSelectClick(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)}
        onKeyUp={(e) => {
          // Keep the menu in sync when arrowing through text (not the menu nav keys).
          if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
            detect(e.currentTarget.value, e.currentTarget.selectionStart ?? 0);
          }
        }}
        onBlur={() => setTimeout(() => setQuery(null), 150)}
        className={className}
        style={className ? style : { ...baseStyle, ...style }}
      />
      {menu}
    </div>
  );
}

const hintStyle: React.CSSProperties = {
  fontSize: 10, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.08em',
  padding: '4px 8px 6px',
};
const itemStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, width: '100%',
  padding: '7px 8px', border: 'none', borderRadius: 8, cursor: 'pointer',
  textAlign: 'left', fontFamily: 'inherit',
};
const avatarStyle: React.CSSProperties = {
  width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
  background: '#E0E7FF', color: '#4338CA', fontSize: 11, fontWeight: 700,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};
