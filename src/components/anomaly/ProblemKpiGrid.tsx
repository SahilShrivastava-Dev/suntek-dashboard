import React from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import type { AnomalyKpi } from '../../lib/anomaly/types';
import { KpiInfoButton } from '../KpiInfoButton';
import { TILE_INFO } from '../../lib/anomaly/tileInfo';

/**
 * Mirrors the main dashboard KPI grid but visually flags KPIs that have an active
 * anomaly. Problem tiles glow red/amber like the main dashboard's red/yellow tiles;
 * healthy tiles render muted so the eye goes straight to the problems.
 */
export function ProblemKpiGrid({ kpis }: { kpis: AnomalyKpi[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 14 }}>
      {kpis.map(k => {
        const problem = k.problem;
        // For pct/inr KPIs, compute a simple delta vs baseline for the trend arrow
        const delta = (k.trend != null && k.baseline != null && k.baseline !== 0)
          ? ((k.trend - k.baseline) / Math.abs(k.baseline)) * 100
          : null;
        const up = (delta ?? 0) >= 0;
        const bg = problem ? '#FEF2F2' : '#fff';
        const border = problem ? '#FECACA' : '#EEF2F6';
        const valueColor = problem ? '#991B1B' : '#0F172A';
        return (
          <div key={k.key} style={{
            background: bg, border: `1px solid ${border}`, borderRadius: 16, padding: '16px 18px',
            position: 'relative',
          }}>
            {TILE_INFO[k.key] && <KpiInfoButton info={TILE_INFO[k.key]} />}
            <div style={{ fontSize: 11, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em', paddingRight: 22, display: 'flex', alignItems: 'center', gap: 6 }}>
              {k.label}
              {problem && (
                <span style={{
                  fontSize: 9, fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#DC2626',
                  background: '#fff', border: '1px solid #FECACA', borderRadius: 20, padding: '1px 7px',
                }}>⚠ flagged</span>
              )}
            </div>
            <div style={{ fontSize: 26, fontWeight: 800, color: valueColor, marginTop: 6, lineHeight: 1 }}>
              {k.value}
            </div>
            {delta != null && (
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 3, marginTop: 8,
                fontSize: 11, fontWeight: 700,
                color: problem ? (up ? '#16A34A' : '#DC2626') : (up ? '#16A34A' : '#DC2626'),
              }}>
                {up ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                {up ? '+' : ''}{delta.toFixed(1)}% vs prior
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
