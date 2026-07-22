import React from 'react';
import { KpiInfoButton } from '../KpiInfoButton';
import type { Database } from '../../lib/database.types';

type AlertRow = Database['public']['Tables']['alerts']['Row'];

const SEV_COLOR: Record<string, string> = { red: '#DC2626', amber: '#D97706', low: '#475569' };

/** Fallback source→route map for older alert rows without an explicit `route`. */
const ALERT_ROUTE: Record<string, string> = {
  'Marine ledger':     '/dashboard/purchase/marine',
  'CPM Stock':         '/dashboard/stock',
  'Batch · Oil Ratio': '/dashboard/batches',
  'Sales · Payments':  '/dashboard/sales',
  'Night Manager':     '/dashboard/night-manager',
  'Maintenance':       '/dashboard/purchase/maint',
};

interface AlertsPanelProps {
  alerts: AlertRow[];
  onNavigate: (route: string) => void;
}

/** Open-alerts feed on the Overview. Pure display; navigation via callback. */
export function AlertsPanel({ alerts, onNavigate }: AlertsPanelProps) {
  return (
    <div className="col-span-12 lg:col-span-3 card p-6" style={{ position: 'relative' }}>
      <KpiInfoButton info={{ title: 'Open Alerts', what: 'Operational alerts across all modules — marine insurance balance, stock levels, batch timing, maintenance overdue. Colour-coded by severity (red=high, amber=medium, grey=low). Click any alert to navigate to the relevant module.', source: 'Supabase', note: 'Live from the alerts table (migration 0003), filtered to unresolved.' }} />
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-base font-bold font-heading">Open alerts</div>
          <div className="text-xs text-slate-500">Click to navigate · real-time</div>
        </div>
        <span className="badge" style={{ background: 'var(--red-soft)', color: 'var(--red)' }}>{alerts.length} open</span>
      </div>
      <div className="space-y-2.5">
        {alerts.map((a) => {
          const route = a.route || ALERT_ROUTE[a.source || ''];
          return (
            <div
              key={a.id}
              className={`flex items-center gap-3 p-2.5 rounded-2xl hover:bg-slate-50 transition-colors ${route ? 'cursor-pointer' : ''}`}
              onClick={() => route && onNavigate(route)}
            >
              <div className="w-2 h-2 rounded-full shrink-0" style={{ background: SEV_COLOR[a.severity] || SEV_COLOR.low }} />
              <div className="flex-1 min-w-0">
                <div className="text-sm leading-tight">{a.text}</div>
                <div className="text-[11px] text-slate-400">{a.source} · {a.when_label}</div>
              </div>
              {route && (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#CBD5E1" strokeWidth="2.4">
                  <path d="m9 6 6 6-6 6"/>
                </svg>
              )}
            </div>
          );
        })}
        {alerts.length === 0 && (
          <div className="text-center text-slate-400 py-4 text-sm">No open alerts</div>
        )}
      </div>
    </div>
  );
}
