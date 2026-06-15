import React, { useState } from 'react';
import { LineChart, BarChart3, TrendingDown, TrendingUp } from 'lucide-react';
import { TimeSeriesChart } from './TimeSeriesChart';
import { useMetricsCatalog, useMetricSeries } from '../../lib/anomaly/useAnomalies';
import { LEVEL_COLOR, LEVEL_LABEL, fmtValue } from '../../lib/anomaly/levels';
import { KpiInfoButton } from '../KpiInfoButton';
import { TILE_INFO } from '../../lib/anomaly/tileInfo';
import type { Grain, Level } from '../../lib/anomaly/types';

const GRAINS: Grain[] = ['daily', 'weekly', 'monthly'];

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { v: T; label: string; icon?: React.ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div style={{ display: 'inline-flex', background: '#F1F5F9', borderRadius: 10, padding: 3, gap: 2 }}>
      {options.map(o => (
        <button key={o.v} onClick={() => onChange(o.v)}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 8,
            border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 600,
            background: value === o.v ? '#fff' : 'transparent',
            color: value === o.v ? '#0F172A' : '#64748B',
            boxShadow: value === o.v ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
          }}>
          {o.icon}{o.label}
        </button>
      ))}
    </div>
  );
}

export function MetricExplorer() {
  const { data: catalog } = useMetricsCatalog();
  const [metric, setMetric] = useState('sales');
  const [grain, setGrain] = useState<Grain>('daily');
  const [mode, setMode] = useState<'line' | 'bar'>('line');

  const { data: series, isLoading } = useMetricSeries(metric, grain);
  const meta = catalog?.metrics.find(m => m.key === metric);
  const unit = (series?.meta.unit ?? meta?.unit ?? 'inr') as 'inr' | 'pct' | 'num';
  const latest = series?.summary.latest;
  const byLevel = series?.summary.byLevel;

  return (
    <div style={{ position: 'relative', background: '#fff', border: '1px solid #EEF2F6', borderRadius: 20, padding: '20px 22px' }}>
      <KpiInfoButton info={TILE_INFO.metricExplorer} />
      {/* Controls row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 6, paddingRight: 26 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <select value={metric} onChange={e => setMetric(e.target.value)}
            style={{ padding: '8px 12px', borderRadius: 10, border: '1px solid #E2E8F0', background: '#F8FAFC', fontSize: 13, fontWeight: 700, color: '#0F172A', fontFamily: 'inherit', cursor: 'pointer' }}>
            {catalog?.metrics.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
          <Segmented value={grain} onChange={setGrain} options={GRAINS.map(g => ({ v: g, label: g[0].toUpperCase() + g.slice(1) }))} />
        </div>
        <Segmented value={mode} onChange={setMode} options={[
          { v: 'line', label: 'Line', icon: <LineChart size={13} /> },
          { v: 'bar', label: 'Bar', icon: <BarChart3 size={13} /> },
        ]} />
      </div>

      <div style={{ fontSize: 12, color: '#94A3B8', marginBottom: 14 }}>{meta?.desc}</div>

      {/* Stat strip */}
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 12 }}>
        {latest && (
          <div>
            <div style={{ fontSize: 10, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Latest ({latest.label})</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 18, fontWeight: 800, color: '#0F172A' }}>
              {fmtValue(latest.value, unit)}
              {latest.baseline != null && (latest.value >= latest.baseline
                ? <TrendingUp size={15} color="#16A34A" /> : <TrendingDown size={15} color="#DC2626" />)}
            </div>
          </div>
        )}
        <div>
          <div style={{ fontSize: 10, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Anomalies in series</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
            {byLevel && (['extreme', 'heavy', 'moderate', 'mild'] as Level[]).map(l => byLevel[l] > 0 ? (
              <span key={l} style={{ fontSize: 11, fontWeight: 700, color: LEVEL_COLOR[l], background: `${LEVEL_COLOR[l]}14`, padding: '2px 8px', borderRadius: 20 }}>
                {byLevel[l]} {LEVEL_LABEL[l]}
              </span>
            ) : null)}
            {byLevel && Object.values(byLevel).every(v => v === 0) && <span style={{ fontSize: 12, color: '#16A34A', fontWeight: 600 }}>none</span>}
          </div>
        </div>
      </div>

      {/* Chart */}
      {isLoading && !series ? (
        <div style={{ height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94A3B8' }}>Loading series…</div>
      ) : (
        <TimeSeriesChart points={series?.points ?? []} unit={unit} mode={mode} />
      )}

      {/* Legend */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 10, fontSize: 10, color: '#94A3B8' }}>
        <Legend swatch="#475569" label="Actual" />
        <Legend swatch="#A5B4FC" label="Expected (mean)" dashed />
        <Legend swatch="#F59E0B" label="EWMA trend" dashed />
        <Legend swatch="#6366F1" label="±2σ band" band />
        <Legend swatch={LEVEL_COLOR.extreme} label="Anomaly (by tier)" dot />
      </div>
    </div>
  );
}

function Legend({ swatch, label, dashed, band, dot }: { swatch: string; label: string; dashed?: boolean; band?: boolean; dot?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      {dot ? <span style={{ width: 8, height: 8, borderRadius: '50%', background: swatch }} />
        : band ? <span style={{ width: 14, height: 8, borderRadius: 2, background: swatch, opacity: 0.2 }} />
        : <span style={{ width: 14, height: 0, borderTop: `2px ${dashed ? 'dashed' : 'solid'} ${swatch}` }} />}
      {label}
    </span>
  );
}
