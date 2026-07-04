import React, { useState, useRef } from 'react';

// ── Constants ─────────────────────────────────────────────────────────────────

export const FREQ_OPTIONS = ['daily', 'weekly', 'fortnightly', 'monthly', 'bimonthly', 'quarterly', 'biannual', 'triannual', 'annual'];
export const FREQ_LABEL: Record<string, string> = {
  daily: 'Daily', weekly: 'Weekly (7d)', fortnightly: 'Fortnightly (15d)', monthly: 'Monthly',
  bimonthly: 'Bi-monthly (2-mo)', quarterly: 'Quarterly (3-mo)', biannual: 'Bi-annual (6-mo)', triannual: '9-monthly',
  annual: 'Yearly (12-mo)',
};
/** Days added per frequency (months use setMonth for calendar correctness). */
export const FREQ_DAYS: Record<string, number> = { daily: 1, weekly: 7, fortnightly: 15 };
export const FREQ_MONTHS: Record<string, number> = { monthly: 1, bimonthly: 2, quarterly: 3, biannual: 6, triannual: 9, annual: 12 };

export const STATUS_CFG: Record<string, { label: string; bg: string; color: string }> = {
  open:                     { label: 'Open',              bg: '#DBEAFE', color: '#2563EB' },
  in_progress:              { label: 'In Progress',       bg: '#FEF3C7', color: '#D97706' },
  pending_store:            { label: 'Pending Store',     bg: '#FEF3C7', color: '#D97706' },
  pending_unit_head:        { label: 'Pending Approval',  bg: '#EDE9FE', color: '#7C3AED' },
  pending_purchase:         { label: 'Purchasing',        bg: '#EDE9FE', color: '#7C3AED' },
  pending_purchase_manager: { label: 'Bill & Dispatch',   bg: '#FAE8FF', color: '#A21CAF' },
  pending_handover:         { label: 'Handover',          bg: '#F3E8FF', color: '#9333EA' },
  pending_defective_return: { label: 'Defective Return',  bg: '#FEF3C7', color: '#D97706' },
  closed:                   { label: 'Closed',            bg: '#DCFCE7', color: '#16A34A' },
};

// pending_purchase is shown in strip but may be skipped (available-in-store path)
export const EMERGENCY_STAGES = [
  'open', 'in_progress', 'pending_store', 'pending_unit_head',
  'pending_purchase', 'pending_purchase_manager', 'pending_handover', 'pending_defective_return', 'closed',
];

export const STAGE_LABELS: Record<string, string> = {
  open: 'Raised', in_progress: 'Assessed', pending_store: 'Store Check',
  pending_unit_head: 'Unit Head', pending_purchase: 'Purchase', pending_purchase_manager: 'Purchase Mgr',
  pending_handover: 'Handover', pending_defective_return: 'Defective', closed: 'Closed',
};

// ── Pure helpers ────────────────────────────────────────────────────────────────

export function statusBadge(status: string) {
  const cfg = STATUS_CFG[status] || { label: status, bg: '#F1F5F9', color: '#475569' };
  return <span className="badge" style={{ background: cfg.bg, color: cfg.color, fontWeight: 700 }}>{cfg.label}</span>;
}

export function formatDate(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function daysFromNow(d: string | null | undefined): number | null {
  if (!d) return null;
  // Compare by calendar date, so a task due *today* (any time) reads as 0, not −1.
  const due = new Date(d); due.setHours(0, 0, 0, 0);
  const now = new Date(); now.setHours(0, 0, 0, 0);
  return Math.round((due.getTime() - now.getTime()) / 86400000);
}

export function dueDateLabel(days: number | null): { text: string; color: string } {
  if (days === null) return { text: '—', color: '#94A3B8' };
  if (days < 0) return { text: `${Math.abs(days)}d overdue`, color: '#DC2626' };
  if (days === 0) return { text: 'Due today', color: '#D97706' };
  if (days <= 3) return { text: `In ${days}d`, color: '#D97706' };
  return { text: `In ${days}d`, color: '#16A34A' };
}

/** Next occurrence = `from` (or now) + the frequency interval. Pass the current
 *  due date as `from` for calendar-anchored recurrence. */
export function calculateNextDue(frequency: string, from?: string | Date | null): string {
  const d = from ? new Date(from) : new Date();
  if (FREQ_DAYS[frequency] != null) d.setDate(d.getDate() + FREQ_DAYS[frequency]);
  else if (FREQ_MONTHS[frequency] != null) d.setMonth(d.getMonth() + FREQ_MONTHS[frequency]);
  else d.setDate(d.getDate() + 7);
  return d.toISOString();
}

// ── PhotoUploader ─────────────────────────────────────────────────────────────

export function PhotoUploader({ onBlobReady, label = 'Attach photo proof', hint = 'Take or upload a photo' }: {
  onBlobReady: (blob: Blob | null) => void;
  label?: string;
  hint?: string;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPreview(URL.createObjectURL(file));
    onBlobReady(file);
  }

  function clear() {
    setPreview(null);
    onBlobReady(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 11, color: '#94A3B8', marginBottom: 10 }}>{hint}</div>
      {preview ? (
        <div style={{ position: 'relative' }}>
          <img src={preview} alt="Preview" style={{ width: '100%', maxHeight: 180, objectFit: 'cover', borderRadius: 12 }} />
          <button onClick={clear} style={{ position: 'absolute', top: 8, right: 8, width: 28, height: 28, borderRadius: '50%', background: 'rgba(0,0,0,0.55)', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
        </div>
      ) : (
        <div onClick={() => inputRef.current?.click()} style={{ border: '2px dashed #CBD5E1', borderRadius: 12, padding: '20px 16px', textAlign: 'center', cursor: 'pointer', background: '#F8FAFC' }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="1.5" style={{ margin: '0 auto 6px' }}>
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
            <circle cx="12" cy="13" r="4"/>
          </svg>
          <div style={{ fontSize: 12, color: '#64748B', fontWeight: 500 }}>Tap to upload a photo</div>
          <div style={{ fontSize: 11, color: '#CBD5E1', marginTop: 2 }}>JPG / PNG · opens camera on mobile</div>
        </div>
      )}
      <input ref={inputRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={handleFile} />
    </div>
  );
}

// ── Stage progress strip ──────────────────────────────────────────────────────

export function StageStrip({ status, skippedStages = [], onStageClick, activeStage }: {
  status: string;
  skippedStages?: string[];
  /** Click a reached stage to see what happened there (read-only). */
  onStageClick?: (stage: string) => void;
  activeStage?: string | null;
}) {
  const idx = EMERGENCY_STAGES.indexOf(status);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 0, marginBottom: 20, overflowX: 'auto', paddingBottom: 2 }}>
      {EMERGENCY_STAGES.map((s, i) => {
        const isPast = i < idx;
        const isCurrent = i === idx;
        const isSkipped = skippedStages.includes(s);
        const isLast = i === EMERGENCY_STAGES.length - 1;
        // A stage is inspectable once reached (past or current) and not skipped.
        const clickable = !!onStageClick && i <= idx && !isSkipped;
        const isActive = activeStage === s;
        return (
          <React.Fragment key={s}>
            <div
              onClick={clickable ? () => onStageClick!(s) : undefined}
              title={clickable ? `View ${STAGE_LABELS[s]} details` : undefined}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, cursor: clickable ? 'pointer' : 'default' }}
            >
              <div style={{
                width: 22, height: 22, borderRadius: '50%',
                background: isSkipped ? '#E2E8F0' : isCurrent ? '#F47651' : isPast ? '#16A34A' : '#E2E8F0',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: isActive ? '2px solid #0F172A' : isCurrent ? '2px solid #F47651' : 'none',
                boxShadow: isActive ? '0 0 0 3px rgba(15,23,42,0.12)' : 'none',
                opacity: isSkipped ? 0.4 : 1,
              }}>
                {isPast && !isSkipped && <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><path d="M20 6 9 17l-5-5"/></svg>}
                {isSkipped && <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="3"><path d="M5 12h14"/></svg>}
                {isCurrent && <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff' }} />}
              </div>
              <div style={{ fontSize: 8.5, fontWeight: isActive || isCurrent ? 700 : 500, color: isActive ? '#0F172A' : isSkipped ? '#CBD5E1' : isCurrent ? '#F47651' : isPast ? '#16A34A' : '#94A3B8', marginTop: 3, whiteSpace: 'nowrap', textDecoration: clickable ? 'underline dotted' : 'none', textUnderlineOffset: 2 }}>
                {STAGE_LABELS[s]}{isSkipped ? ' (skipped)' : ''}
              </div>
            </div>
            {!isLast && <div style={{ height: 2, flex: 1, minWidth: 12, background: (isPast && !isSkipped) ? '#16A34A' : '#E2E8F0', marginTop: 10, flexShrink: 0 }} />}
          </React.Fragment>
        );
      })}
    </div>
  );
}
