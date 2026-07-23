import React from 'react';
import { useAnalytics } from '../../lib/anomaly/useAnomalies';
import { ConcentrationBar, DeltaBadge } from '../charts/AnalyticsViz';
import { LEVEL_COLOR, LEVEL_LABEL, fmtValue } from '../../lib/anomaly/levels';
import { KpiInfoButton } from '../KpiInfoButton';
import { TILE_INFO } from '../../lib/anomaly/tileInfo';
import type { AnalyticsResult, Level } from '../../lib/anomaly/types';

// ── Card shell ────────────────────────────────────────────────────────────────
function Panel({ title, sub, children, span = 1, infoKey }: { title: string; sub?: string; children: React.ReactNode; span?: number; infoKey?: string }) {
  return (
    <div style={{ flex: `${span} 1 300px`, minWidth: 300, position: 'relative', background: '#fff', border: '1px solid #EEF2F6', borderRadius: 18, padding: '16px 18px', display: 'flex', flexDirection: 'column' }}>
      {infoKey && TILE_INFO[infoKey] && <KpiInfoButton info={TILE_INFO[infoKey]} />}
      <div style={{ marginBottom: 12, paddingRight: 22 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#0F172A' }}>{title}</div>
        {sub && <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 1 }}>{sub}</div>}
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>{children}</div>
    </div>
  );
}

// ── 1. Margin health gauge (speedometer) ──────────────────────────────────────
function pt(cx: number, cy: number, r: number, deg: number) { const a = (deg * Math.PI) / 180; return { x: cx + r * Math.cos(a), y: cy - r * Math.sin(a) }; }
function arc(cx: number, cy: number, r: number, a0: number, a1: number) { const p0 = pt(cx, cy, r, a0), p1 = pt(cx, cy, r, a1); const large = Math.abs(a1 - a0) > 180 ? 1 : 0; return `M ${p0.x.toFixed(1)},${p0.y.toFixed(1)} A ${r},${r} 0 ${large} 1 ${p1.x.toFixed(1)},${p1.y.toFixed(1)}`; }

function MarginGauge({ margin }: { margin: AnalyticsResult['margin'] }) {
  const cx = 110, cy = 105, r = 78, sw = 16;
  const MAX = 40; // 0..40% margin scale
  const v = Math.max(0, Math.min(MAX, margin.recentPct * 100));
  const ang = (val: number) => 180 - (val / MAX) * 180;
  const color = v < 10 ? '#DC2626' : v < 20 ? '#D97706' : '#16A34A';
  const delta = (margin.recentPct - margin.priorPct) * 100;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <svg width="220" height="125" viewBox="0 0 220 125">
        <path d={arc(cx, cy, r, 180, ang(10))} fill="none" stroke="#FEE2E2" strokeWidth={sw} />
        <path d={arc(cx, cy, r, ang(10), ang(20))} fill="none" stroke="#FEF3C7" strokeWidth={sw} />
        <path d={arc(cx, cy, r, ang(20), 0)} fill="none" stroke="#DCFCE7" strokeWidth={sw} />
        <path d={arc(cx, cy, r, 180, ang(v))} fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" />
        <circle cx={pt(cx, cy, r, ang(v)).x} cy={pt(cx, cy, r, ang(v)).y} r={7} fill={color} stroke="#fff" strokeWidth={2} />
        <text x={cx} y={cy - 8} textAnchor="middle" fontSize="30" fontWeight="800" fill={color}>{v.toFixed(1)}%</text>
        <text x={cx} y={cy + 10} textAnchor="middle" fontSize="10" fill="#94A3B8">14-day gross margin</text>
        <text x={cx - r} y={cy + 16} textAnchor="middle" fontSize="8" fill="#CBD5E1">0%</text>
        <text x={cx + r} y={cy + 16} textAnchor="middle" fontSize="8" fill="#CBD5E1">40%+</text>
      </svg>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#64748B' }}>
        vs prior 14d <DeltaBadge value={delta} unit="pp" />
      </div>
    </div>
  );
}

// ── 2. Severity mix donut ─────────────────────────────────────────────────────
function SeverityDonut({ radar, timeline }: { radar: AnalyticsResult['radar']; timeline: AnalyticsResult['timeline'] }) {
  const totals: Record<Level, number> = { mild: 0, moderate: 0, heavy: 0, extreme: 0 };
  timeline.forEach(t => { (['mild', 'moderate', 'heavy', 'extreme'] as Level[]).forEach(l => totals[l] += t[l]); });
  const all = (['extreme', 'heavy', 'moderate', 'mild'] as Level[]);
  const total = all.reduce((s, l) => s + totals[l], 0);
  const r = 52, sw = 16, cx = 70, cy = 70, circ = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      <svg width="140" height="140" viewBox="0 0 140 140">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#F1F5F9" strokeWidth={sw} />
        {total > 0 && all.map(l => {
          const frac = totals[l] / total; const len = circ * frac;
          const el = <circle key={l} cx={cx} cy={cy} r={r} fill="none" stroke={LEVEL_COLOR[l]} strokeWidth={sw}
            strokeDasharray={`${len} ${circ - len}`} strokeDashoffset={-offset} transform={`rotate(-90 ${cx} ${cy})`} />;
          offset += len; return el;
        })}
        <text x={cx} y={cy - 2} textAnchor="middle" fontSize="26" fontWeight="800" fill="#0F172A">{total}</text>
        <text x={cx} y={cy + 14} textAnchor="middle" fontSize="9" fill="#94A3B8">anomalies</text>
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {all.map(l => (
          <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12 }}>
            <span style={{ width: 9, height: 9, borderRadius: 3, background: LEVEL_COLOR[l] }} />
            <span style={{ color: '#475569' }}>{LEVEL_LABEL[l]}</span>
            <strong style={{ marginLeft: 'auto', color: '#0F172A' }}>{totals[l]}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 3. Sales vs Purchase dual area ────────────────────────────────────────────
function DualArea({ data }: { data: AnalyticsResult['salesPurchase'] }) {
  const W = 360, H = 130, P = { t: 10, r: 8, b: 18, l: 8 };
  const pw = W - P.l - P.r, ph = H - P.t - P.b;
  const max = Math.max(...data.flatMap(d => [d.sales, d.purchase]), 1);
  const n = data.length;
  const x = (i: number) => P.l + (n <= 1 ? pw / 2 : (i / (n - 1)) * pw);
  const y = (v: number) => P.t + ph - (v / max) * ph;
  const line = (key: 'sales' | 'purchase') => data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${x(i)},${y(d[key])}`).join(' ');
  const area = (key: 'sales' | 'purchase') => `${line(key)} L ${x(n - 1)},${P.t + ph} L ${x(0)},${P.t + ph} Z`;
  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: 'block' }}>
        <path d={area('sales')} fill="#16A34A" opacity={0.10} />
        <path d={area('purchase')} fill="#DC2626" opacity={0.10} />
        <path d={line('sales')} fill="none" stroke="#16A34A" strokeWidth={2} />
        <path d={line('purchase')} fill="none" stroke="#DC2626" strokeWidth={2} />
        {data.map((d, i) => (i % 2 === 0 || i === n - 1) ? <text key={i} x={x(i)} y={H - 5} textAnchor="middle" fontSize="8" fill="#94A3B8">{d.label}</text> : null)}
      </svg>
      <div style={{ display: 'flex', gap: 14, marginTop: 4, fontSize: 11 }}>
        <span style={{ color: '#16A34A', fontWeight: 600 }}>● Sales</span>
        <span style={{ color: '#DC2626', fontWeight: 600 }}>● Purchase</span>
        <span style={{ color: '#94A3B8', marginLeft: 'auto' }}>weekly · gap = margin</span>
      </div>
    </div>
  );
}

// ── 4. Metric z-score risk bars ───────────────────────────────────────────────
function ZScoreBars({ radar }: { radar: AnalyticsResult['radar'] }) {
  const CAP = 6; // ±6σ → full half-width
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {radar.map(m => {
        const frac = Math.max(-1, Math.min(1, m.z / CAP));
        const color = m.severity === 'normal' ? '#CBD5E1' : LEVEL_COLOR[m.severity as Level];
        return (
          <div key={m.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 96, fontSize: 11, color: '#475569', textAlign: 'right', flexShrink: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.label}</span>
            <div style={{ flex: 1, position: 'relative', height: 14, background: '#F8FAFC', borderRadius: 4 }}>
              <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: '#CBD5E1' }} />
              <div style={{
                position: 'absolute', top: 2, bottom: 2, borderRadius: 3, background: color,
                left: frac < 0 ? `${50 + frac * 50}%` : '50%', width: `${Math.abs(frac) * 50}%`,
              }} />
            </div>
            <span style={{ width: 42, fontSize: 11, fontWeight: 700, color, textAlign: 'right', flexShrink: 0 }}>{m.z > 0 ? '+' : ''}{m.z.toFixed(1)}σ</span>
          </div>
        );
      })}
    </div>
  );
}

// ── 5. Anomaly timeline (stacked bars per week) ───────────────────────────────
function TimelineBars({ timeline }: { timeline: AnalyticsResult['timeline'] }) {
  const order: Level[] = ['mild', 'moderate', 'heavy', 'extreme'];
  const maxTotal = Math.max(...timeline.map(t => t.total), 1);
  const H = 120, barMax = 92;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: H, paddingTop: 6 }}>
      {timeline.map(t => {
        const h = (t.total / maxTotal) * barMax;
        return (
          <div key={t.key} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', minWidth: 0 }}>
            <div style={{ width: '70%', minWidth: 8, display: 'flex', flexDirection: 'column-reverse', height: h, borderRadius: 4, overflow: 'hidden' }}>
              {order.map(l => t[l] > 0 ? <div key={l} style={{ background: LEVEL_COLOR[l], height: `${(t[l] / t.total) * 100}%` }} /> : null)}
            </div>
            <span style={{ fontSize: 8, color: '#94A3B8', marginTop: 4, whiteSpace: 'nowrap' }}>{t.label}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── 7. Top debtor bars ────────────────────────────────────────────────────────
function DebtorBars({ debtors }: { debtors: AnalyticsResult['debtors'] }) {
  const max = Math.max(...debtors.map(d => d.outstanding), 1);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {debtors.map(d => (
        <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 120, fontSize: 11, color: '#475569', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flexShrink: 0 }}>{d.name}</span>
          <div style={{ flex: 1, height: 14, background: '#F8FAFC', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${(d.outstanding / max) * 100}%`, background: d.outstanding >= 2e6 ? '#DC2626' : d.outstanding >= 1e6 ? '#EA580C' : '#D97706', borderRadius: 4 }} />
          </div>
          <span style={{ width: 56, fontSize: 11, fontWeight: 700, color: '#0F172A', textAlign: 'right', flexShrink: 0 }}>{fmtValue(d.outstanding, 'inr')}</span>
        </div>
      ))}
    </div>
  );
}

// ── Grid ──────────────────────────────────────────────────────────────────────
export function AnomalyAnalyticsGrid() {
  const { data, isLoading } = useAnalytics();
  if (isLoading || !data) {
    return <div style={{ padding: '40px 0', textAlign: 'center', color: '#94A3B8', fontSize: 13 }}>Building analytics…</div>;
  }
  return (
    // Flex-wrap so a short last row stretches to fill the width — no empty slot
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
      <Panel title="Margin health" sub="speedometer · red <10% · amber <20% · green ≥20%" infoKey="marginGauge"><MarginGauge margin={data.margin} /></Panel>
      <Panel title="Severity mix" sub="all detected anomalies by tier" infoKey="severityMix"><SeverityDonut radar={data.radar} timeline={data.timeline} /></Panel>
      <Panel title="Sales vs Purchase" sub="weekly — the margin squeeze" infoKey="salesVsPurchase"><DualArea data={data.salesPurchase} /></Panel>
      <Panel title="Metric risk radar" sub="latest deviation per metric (σ)" infoKey="riskRadar"><ZScoreBars radar={data.radar} /></Panel>
      <Panel title="Anomaly timeline" sub="anomalies per week, stacked by tier" infoKey="anomalyTimeline"><TimelineBars timeline={data.timeline} /></Panel>
      <Panel title="Vendor concentration" sub="raw-material supplier share (FY)" infoKey="vendorConcentration">
        {data.vendors.length ? <ConcentrationBar segments={data.vendors.map(v => ({ name: v.name, sharePct: v.sharePct }))} /> : <div style={{ color: '#94A3B8', fontSize: 12 }}>No vendor data</div>}
      </Panel>
      <Panel title="Top debtors" sub="outstanding receivables" span={1} infoKey="topDebtors"><DebtorBars debtors={data.debtors} /></Panel>
    </div>
  );
}
