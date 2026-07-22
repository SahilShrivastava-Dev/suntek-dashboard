import React from 'react';
import { KpiInfoButton } from '../KpiInfoButton';
import type { Database } from '../../lib/database.types';

type TankRow = Database['public']['Tables']['tanks']['Row'];

interface StockSnapshotProps {
  densities: number[];
  locations: string[];
  matrix: Record<string, number[]>;
  tanks: TankRow[];
  onOpenStock: () => void;
}

/**
 * Read-only CPM density×location matrix + tank levels shown on the Overview.
 * Pure display — extracted from Overview to keep that file focused.
 */
export function StockSnapshot({ densities, locations, matrix, tanks, onOpenStock }: StockSnapshotProps) {
  return (
    <div className="grid grid-cols-12 gap-5 mb-5">
      {/* CPM Matrix — green-soft */}
      <div className="col-span-12 lg:col-span-7 card2 p-6" style={{ position: 'relative' }}>
        <KpiInfoButton info={{ title: 'CPM Stock Matrix', what: 'Drums of CP (Chemical Product) on hand at each location, broken down by density grade. Cell shading intensity shows relative volume — darker = more stock. Click "Open Stock" for full inventory view.', source: 'Supabase', note: 'Live from the cpm_drum_stock table (migration 0002), pivoted into the matrix.' }} />
        <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
          <div>
            <div className="text-base font-bold">CPM Stock · density × location</div>
            <div className="text-xs text-slate-500">Drums on hand, live · cell shading shows relative volume</div>
          </div>
          <button className="btn-outline pill px-3 py-2 text-xs font-semibold" onClick={onOpenStock}>
            Open Stock →
          </button>
        </div>
        <div className="overflow-x-auto scroll-x">
          <table className="dt">
            <thead>
              <tr>
                <th>Location</th>
                {densities.map(d => (
                  <th key={d} className="num">d {d}</th>
                ))}
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {locations.map(loc => {
                const row = matrix[loc];
                const total = row.reduce((a, b) => a + b, 0);
                return (
                  <tr key={loc}>
                    <td className="font-semibold">{loc}</td>
                    {row.map((v, i) => {
                      const intensity = Math.min(v / 400, 1);
                      return (
                        <td key={i} className="num">
                          <span style={{ background: `rgba(244,118,81,${intensity * 0.28})`, padding: '3px 10px', borderRadius: '8px' }}>
                            {v}
                          </span>
                        </td>
                      );
                    })}
                    <td className="num font-bold">{total}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Tank levels — each card navigates to Stock page */}
      <div className="col-span-12 lg:col-span-5 card2 p-6" style={{ position: 'relative' }}>
        <KpiInfoButton info={{ title: 'Tank Levels', what: 'Current fill level of each raw material / output tank at port and factory locations. Red = low alert, orange = 30-70%, green = above 70%. Click any tank to open the full stock view.', source: 'Supabase', note: 'Live from the tanks table (migration 0002).' }} />
        <div className="text-base font-bold">Tank levels · port + factory</div>
        <div className="text-xs text-slate-500 mb-4">Click any tank to open full stock view</div>
        <div className="space-y-2.5">
          {tanks.map(tk => {
            const color = tk.alert ? '#DC2626' : tk.level_pct > 70 ? '#16A34A' : tk.level_pct > 30 ? '#F47651' : '#D97706';
            return (
              <div
                key={tk.id}
                className="p-2.5 rounded-2xl border border-slate-100 hover:bg-slate-50 cursor-pointer hover:border-slate-200 transition-colors"
                onClick={onOpenStock}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div>
                    <div className="font-semibold text-sm">{tk.name}</div>
                    <div className="text-[11px] text-slate-500">{tk.location} · cap {tk.capacity} {tk.unit}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold num text-sm">{Math.round((tk.capacity ?? 0) * tk.level_pct / 100)} {tk.unit}</div>
                    <div className="text-[11px] font-semibold" style={{ color }}>
                      {tk.level_pct}%{tk.alert ? ' · low' : ''}
                    </div>
                  </div>
                </div>
                <div className="progress" style={{ height: '6px' }}>
                  <div style={{ width: `${tk.level_pct}%`, background: color }} />
                </div>
              </div>
            );
          })}
          {tanks.length === 0 && (
            <div className="text-center text-slate-400 py-6 text-sm">No tanks configured</div>
          )}
        </div>
      </div>
    </div>
  );
}
