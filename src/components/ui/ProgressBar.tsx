import React, { useEffect, useRef, useState } from 'react';

/**
 * Shared 0–100% progress bar. Promoted from the local `UploadBar` in Maintenance so
 * uploads AND AI/OCR extraction show the same indicator instead of static
 * "Reading the bill…" text.
 */
export function ProgressBar({
  pct,
  label,
  color = 'var(--accent)',
}: {
  pct: number;
  label?: string;
  color?: string;
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  return (
    <div style={{ marginBottom: 12 }}>
      {label && (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#64748B', marginBottom: 4 }}>
          <span>{label}</span>
          <span style={{ fontWeight: 600, color: '#334155' }}>{clamped}%</span>
        </div>
      )}
      <div style={{ height: 5, background: '#E2E8F0', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ height: 5, background: color, borderRadius: 4, width: `${clamped}%`, transition: 'width 0.25s ease' }} />
      </div>
    </div>
  );
}

/**
 * Simulated progress for operations with no real streamed percentage (a single
 * vision-model call). While `active`, eases toward `ceiling` (default 90%) so the
 * bar keeps moving; call the returned `complete()` on success to snap to 100%, or
 * `reset()` to clear. Optionally anchors to a real `page X of N` fraction as a floor.
 */
export function useFakeProgress(active: boolean, opts?: { ceiling?: number; floor?: number }): {
  pct: number;
  complete: () => void;
  reset: () => void;
} {
  const ceiling = opts?.ceiling ?? 90;
  const [pct, setPct] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (active) {
      setPct(p => (p > 0 && p < 100 ? p : 8));
      timer.current = setInterval(() => {
        setPct(p => {
          const target = Math.max(ceiling, opts?.floor ?? 0);
          if (p >= target) return p;
          // Decelerate as it approaches the ceiling.
          const step = Math.max(0.5, (target - p) * 0.12);
          return Math.min(target, p + step);
        });
      }, 350);
    }
    return () => { if (timer.current) { clearInterval(timer.current); timer.current = null; } };
  }, [active, ceiling, opts?.floor]);

  // Let a rising real floor (per-page progress) pull the bar forward.
  useEffect(() => {
    if (opts?.floor != null) setPct(p => Math.max(p, opts.floor!));
  }, [opts?.floor]);

  return {
    pct,
    complete: () => { if (timer.current) clearInterval(timer.current); setPct(100); },
    reset: () => { if (timer.current) clearInterval(timer.current); setPct(0); },
  };
}
