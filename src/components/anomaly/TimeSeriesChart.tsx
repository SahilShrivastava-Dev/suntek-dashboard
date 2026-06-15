import React, { useRef, useState } from 'react';
import type { SeriesPoint, Level } from '../../lib/anomaly/types';
import { LEVEL_COLOR, fmtValue } from '../../lib/anomaly/levels';

interface Props {
  points: SeriesPoint[];
  unit: 'inr' | 'pct' | 'num';
  mode: 'line' | 'bar';
  height?: number;
}

const PAD = { top: 16, right: 16, bottom: 28, left: 56 };

/**
 * Custom SVG time-series chart with a statistical baseline band (mean ± 2σ),
 * EWMA trend line, and anomaly points coloured by severity tier. Hovering shows a
 * tooltip with the value, expected baseline, and z-score. No chart dependency — full
 * control over the data-science presentation, matches the app's hand-built SVG style.
 */
export function TimeSeriesChart({ points, unit, mode, height = 300 }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [w, setW] = useState(820);

  React.useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver(entries => { for (const e of entries) setW(e.contentRect.width); });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  if (!points.length) return <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94A3B8' }}>No data</div>;

  const plotW = Math.max(200, w - PAD.left - PAD.right);
  const plotH = height - PAD.top - PAD.bottom;

  // Y domain from values + baselines (robust to band blow-ups: ignore bands in domain)
  const ys: number[] = [];
  points.forEach(p => { ys.push(p.value); if (p.baseline != null) ys.push(p.baseline); });
  let yMin = Math.min(...ys), yMax = Math.max(...ys);
  if (yMin === yMax) { yMin -= 1; yMax += 1; }
  const padY = (yMax - yMin) * 0.12;
  yMin -= padY; yMax += padY;
  if (unit !== 'pct' && yMin > 0) yMin = 0; // zero-base money/count charts

  const n = points.length;
  const x = (i: number) => PAD.left + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number) => PAD.top + plotH - ((v - yMin) / (yMax - yMin)) * plotH;
  const clamp = (v: number) => Math.max(PAD.top, Math.min(PAD.top + plotH, v));

  // Gridlines / y-ticks
  const ticks = 4;
  const yTicks = Array.from({ length: ticks + 1 }, (_, i) => yMin + (i / ticks) * (yMax - yMin));
  // sparse x labels
  const xStep = Math.max(1, Math.ceil(n / 8));

  // Baseline band polygon (mean ± 2σ), clipped
  const bandPts = points.filter(p => p.upper != null && p.lower != null);
  let bandPath = '';
  if (bandPts.length > 1) {
    const top = points.map((p, i) => p.upper != null ? `${x(i)},${clamp(y(p.upper))}` : null).filter(Boolean);
    const bot = points.map((p, i) => p.lower != null ? `${x(i)},${clamp(y(p.lower))}` : null).filter(Boolean).reverse();
    bandPath = `M ${[...top, ...bot].join(' L ')} Z`;
  }

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)},${y(p.value)}`).join(' ');
  const ewmaPath = points.every(p => p.ewma != null)
    ? points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)},${y(p.ewma as number)}`).join(' ')
    : '';
  const baselinePath = points.map((p, i) => p.baseline != null ? `${x(i)},${y(p.baseline)}` : null)
    .reduce((acc: string, cur, i) => cur ? `${acc}${acc ? ' L' : 'M'} ${cur}` : acc, '');

  const barW = Math.max(2, (plotW / n) * 0.6);

  return (
    <div ref={wrapRef} style={{ position: 'relative', width: '100%' }}>
      <svg width={w} height={height} style={{ display: 'block' }}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = (e.currentTarget as SVGElement).getBoundingClientRect();
          const mx = e.clientX - rect.left;
          const i = Math.round(((mx - PAD.left) / plotW) * (n - 1));
          setHover(Math.max(0, Math.min(n - 1, i)));
        }}
      >
        {/* gridlines + y labels */}
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={PAD.left} x2={PAD.left + plotW} y1={y(t)} y2={y(t)} stroke="#F1F5F9" strokeWidth={1} />
            <text x={PAD.left - 8} y={y(t) + 3} textAnchor="end" fontSize={9} fill="#94A3B8">{fmtValue(t, unit)}</text>
          </g>
        ))}
        {/* zero line for pct/net */}
        {yMin < 0 && yMax > 0 && (
          <line x1={PAD.left} x2={PAD.left + plotW} y1={y(0)} y2={y(0)} stroke="#CBD5E1" strokeWidth={1} strokeDasharray="2 2" />
        )}

        {/* baseline band */}
        {bandPath && <path d={bandPath} fill="#6366F1" opacity={0.07} />}
        {baselinePath && <path d={baselinePath} fill="none" stroke="#A5B4FC" strokeWidth={1.5} strokeDasharray="4 3" />}

        {/* x labels */}
        {points.map((p, i) => (i % xStep === 0 || i === n - 1) ? (
          <text key={i} x={x(i)} y={height - 9} textAnchor="middle" fontSize={9} fill="#94A3B8">{p.label}</text>
        ) : null)}

        {/* series */}
        {mode === 'bar' ? (
          points.map((p, i) => {
            const c = p.isAnomaly ? LEVEL_COLOR[p.severity as Level] : '#CBD5E1';
            const yv = y(p.value); const y0 = y(Math.max(0, yMin));
            const top = Math.min(yv, y0), h = Math.abs(yv - y0);
            return <rect key={i} x={x(i) - barW / 2} y={top} width={barW} height={Math.max(1, h)} rx={2}
              fill={c} opacity={hover === i ? 1 : 0.85} />;
          })
        ) : (
          <>
            <path d={linePath} fill="none" stroke="#475569" strokeWidth={1.8} />
            {ewmaPath && <path d={ewmaPath} fill="none" stroke="#F59E0B" strokeWidth={1.4} strokeDasharray="5 3" opacity={0.7} />}
            {points.map((p, i) => p.isAnomaly ? (
              <circle key={i} cx={x(i)} cy={y(p.value)} r={hover === i ? 6 : 4.5}
                fill={LEVEL_COLOR[p.severity as Level]} stroke="#fff" strokeWidth={1.5} />
            ) : (
              <circle key={i} cx={x(i)} cy={y(p.value)} r={hover === i ? 4 : 2} fill="#94A3B8" />
            ))}
          </>
        )}

        {/* hover guide */}
        {hover != null && (
          <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + plotH} stroke="#CBD5E1" strokeWidth={1} />
        )}
      </svg>

      {/* tooltip */}
      {hover != null && (() => {
        const p = points[hover];
        const left = Math.min(Math.max(x(hover) + 10, 8), w - 180);
        return (
          <div style={{
            position: 'absolute', left, top: 8, width: 168, pointerEvents: 'none',
            background: '#0F172A', color: '#fff', borderRadius: 10, padding: '9px 11px',
            fontSize: 11, boxShadow: '0 8px 24px rgba(0,0,0,0.2)', zIndex: 5,
          }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>{p.label}</div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#94A3B8' }}>Value</span><strong>{fmtValue(p.value, unit)}</strong></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#94A3B8' }}>Expected</span><span>{fmtValue(p.baseline, unit)}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#94A3B8' }}>z-score</span><span>{p.warming ? '—' : p.z.toFixed(2)}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3 }}>
              <span style={{ color: '#94A3B8' }}>Status</span>
              <span style={{ fontWeight: 700, color: p.isAnomaly ? LEVEL_COLOR[p.severity as Level] : '#86EFAC' }}>
                {p.warming ? 'calibrating' : p.isAnomaly ? p.severity : 'normal'}
              </span>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
