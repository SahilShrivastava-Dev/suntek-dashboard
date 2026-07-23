import React from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import type { AnomalyKpi } from '../../lib/anomaly/types';
import { KpiInfoButton } from '../KpiInfoButton';
import { TILE_INFO } from '../../lib/anomaly/tileInfo';

/**
 * Mirrors the main dashboard KPI grid in the neutral "Today's Work" card format.
 * KPIs with an active anomaly carry a small FLAGGED chip; the card itself stays
 * neutral so the page reads as one system.
 */
export function ProblemKpiGrid({ kpis }: { kpis: AnomalyKpi[] }) {
  return (
    // Flex-wrap (not grid) so a short last row stretches to fill — no orphan gap
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
      {kpis.map(k => {
        const problem = k.problem;
        // For pct/inr KPIs, compute a simple delta vs baseline for the trend arrow
        const delta = (k.trend != null && k.baseline != null && k.baseline !== 0)
          ? ((k.trend - k.baseline) / Math.abs(k.baseline)) * 100
          : null;
        const up = (delta ?? 0) >= 0;
        return (
          <div key={k.key} className="relative border border-slate-200 rounded-[10px] p-4 bg-white" style={{ flex: '1 1 210px', minWidth: 210 }}>
            {TILE_INFO[k.key] && <KpiInfoButton info={TILE_INFO[k.key]} />}
            <div className="text-[12.5px] text-slate-600 leading-snug flex items-center gap-1.5" style={{ paddingRight: 22 }}>
              {k.label}
              {problem && (
                <span style={{
                  fontSize: 9, fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#DC2626',
                  background: '#fff', border: '1px solid #FECACA', borderRadius: 20, padding: '1px 7px',
                }}>⚠ flagged</span>
              )}
            </div>
            <div className="text-[26px] font-bold text-slate-900 leading-tight num">
              {k.value}
            </div>
            {delta != null && (
              <div className={`inline-flex items-center gap-1 mt-0.5 text-[11.5px] font-medium ${up ? 'text-green-600' : 'text-red-600'}`}>
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
