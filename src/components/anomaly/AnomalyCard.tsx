import React from 'react';
import { AlertTriangle, ChevronRight } from 'lucide-react';
import type { AnomalyFinding } from '../../lib/anomaly/types';
import { LEVEL_COLOR, LEVEL_BG, LEVEL_LABEL } from '../../lib/anomaly/levels';

const LAYER_LABEL: Record<string, string> = { rule: 'Rule', stat: 'Statistical', ml: 'ML', llm: 'AI' };

export function AnomalyCard({ finding, onClick }: { finding: AnomalyFinding; onClick: () => void }) {
  const color = LEVEL_COLOR[finding.level];
  const bg = LEVEL_BG[finding.level];
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 14,
        background: bg, border: `1px solid ${color}33`, borderRadius: 16,
        padding: '16px 18px', cursor: 'pointer', transition: 'box-shadow 0.15s',
        borderLeft: `4px solid ${color}`,
      }}
      onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 6px 20px rgba(0,0,0,0.08)'; }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none'; }}
    >
      <div style={{
        width: 40, height: 40, borderRadius: 12, flexShrink: 0,
        background: '#fff', border: `1px solid ${color}33`,
        display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 1,
      }}>
        <AlertTriangle size={18} color={color} />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
          <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '2px 8px', borderRadius: 20, background: color, color: '#fff' }}>
            {LEVEL_LABEL[finding.level]}
          </span>
          <span style={{ fontSize: 10, color: '#94A3B8', fontWeight: 600 }}>{finding.anomaly_type}</span>
          <span style={{ fontSize: 9, color: '#64748B', padding: '1px 7px', borderRadius: 20, background: '#fff', border: '1px solid #E2E8F0' }}>
            {LAYER_LABEL[finding.layer] || finding.layer} · Tier {finding.tier}
          </span>
        </div>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#0F172A', lineHeight: 1.3 }}>{finding.title}</div>
        <div style={{ fontSize: 12.5, color: '#475569', marginTop: 5, lineHeight: 1.5 }}>{finding.body}</div>
      </div>

      <ChevronRight size={18} color="#94A3B8" style={{ flexShrink: 0, marginTop: 10 }} />
    </div>
  );
}
