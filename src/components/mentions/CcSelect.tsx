import React, { useState } from 'react';
import { useDirectory } from '../../lib/mentions';

/**
 * Multi-select "CC / Watchers" control. Holds a list of profile ids; everyone
 * selected gets notified in parallel whenever the host entity changes.
 */
interface Props {
  value: string[];
  onChange: (ids: string[]) => void;
  label?: string;
  excludeIds?: string[];
  placeholder?: string;
}

export function CcSelect({ value, onChange, label = 'CC / Watchers', excludeIds, placeholder = 'Add people to keep in the loop…' }: Props) {
  const people = useDirectory();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');

  const selected = people.filter((p) => value.includes(p.id));
  const available = people.filter((p) =>
    !value.includes(p.id) &&
    !excludeIds?.includes(p.id) &&
    (p.name.toLowerCase().includes(q.toLowerCase()) || p.roleLabel.toLowerCase().includes(q.toLowerCase())),
  );

  function add(id: string) { onChange([...value, id]); setQ(''); }
  function remove(id: string) { onChange(value.filter((v) => v !== id)); }

  return (
    <div style={{ position: 'relative' }}>
      {label && (
        <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#475569', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {label}
        </label>
      )}
      <div
        onClick={() => setOpen(true)}
        style={{
          display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center',
          minHeight: 40, padding: '6px 10px', border: '1px solid #E2E8F0',
          borderRadius: 12, background: '#F8FAFC', cursor: 'text',
        }}
      >
        {selected.map((p) => (
          <span key={p.id} style={chipStyle}>
            {p.name}
            <button type="button" onClick={(e) => { e.stopPropagation(); remove(p.id); }} style={chipXStyle} aria-label={`Remove ${p.name}`}>×</button>
          </span>
        ))}
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={selected.length ? '' : placeholder}
          style={{ flex: 1, minWidth: 120, border: 'none', outline: 'none', background: 'transparent', fontSize: 13, fontFamily: 'inherit', color: '#0F172A' }}
        />
      </div>

      {open && available.length > 0 && (
        <div style={dropdownStyle}>
          {available.slice(0, 8).map((p) => (
            <button
              key={p.id}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); add(p.id); }}
              style={itemStyle}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#F1F5F9')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <span style={avatarStyle}>{p.initials}</span>
              <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', minWidth: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#0F172A' }}>{p.name}</span>
                <span style={{ fontSize: 11, color: '#94A3B8' }}>{p.roleLabel}{p.plant ? ' · ' + p.plant : ''}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const chipStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5,
  background: '#E0E7FF', color: '#3730A3', borderRadius: 999,
  padding: '3px 6px 3px 10px', fontSize: 12, fontWeight: 600,
};
const chipXStyle: React.CSSProperties = {
  border: 'none', background: 'rgba(67,56,202,0.15)', color: '#3730A3',
  borderRadius: '50%', width: 16, height: 16, lineHeight: '14px',
  fontSize: 13, cursor: 'pointer', padding: 0,
};
const dropdownStyle: React.CSSProperties = {
  position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, zIndex: 60,
  background: '#fff', borderRadius: 12, border: '1px solid #E2E8F0',
  boxShadow: '0 12px 32px rgba(15,23,42,0.16)', padding: 4, maxHeight: 260, overflowY: 'auto',
};
const itemStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, width: '100%',
  padding: '7px 8px', border: 'none', borderRadius: 8, cursor: 'pointer',
  textAlign: 'left', fontFamily: 'inherit', background: 'transparent',
};
const avatarStyle: React.CSSProperties = {
  width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
  background: '#E0E7FF', color: '#4338CA', fontSize: 11, fontWeight: 700,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};
