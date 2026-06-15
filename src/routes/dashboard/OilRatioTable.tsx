import React, { useState } from 'react';
import { OIL_RATIO_SUNTEK, OIL_RATIO_MANAV } from '../../data/mockData';

type Variant = 'suntek' | 'manav';

function varianceColor(vr: number): string {
  if (Math.abs(vr) > 1.5) return 'var(--red)';
  if (Math.abs(vr) > 1)   return 'var(--amber)';
  return 'var(--green)';
}

export function OilRatioTable() {
  const [variant, setVariant] = useState<Variant>('suntek');
  const [selectedDensity, setSelectedDensity] = useState<number | null>(null);
  const data = variant === 'suntek' ? OIL_RATIO_SUNTEK : OIL_RATIO_MANAV;

  const selectedRow = data.find(r => r.d === selectedDensity) ?? null;

  return (
    <div>
      <div className="grid grid-cols-12 gap-5">
        {/* Main table card */}
        <div
          className={`card p-6 ${selectedRow ? 'col-span-12 lg:col-span-8' : 'col-span-12'}`}
          style={{ background: 'var(--green-soft)', border: '1px solid #bbf7d0' }}
        >
          {/* Header row */}
          <div className="flex items-start justify-between mb-3 flex-wrap gap-3">
            <div>
              <div className="text-base font-bold flex items-center gap-2">
                Oil Ratio Table{' '}
                <span
                  className="text-xs font-semibold px-2 py-0.5 rounded-full"
                  style={{ background: 'var(--accent-soft)', color: 'var(--accent-deep)' }}
                >
                  the brain
                </span>
              </div>
              <div className="text-xs text-slate-500">
                Per-density coefficients · per company variant · versioned · click any row to inspect
              </div>
            </div>

            {/* Variant chips */}
            <div className="flex items-center gap-2 flex-wrap">
              {(['suntek', 'manav'] as Variant[]).map(v => (
                <button
                  key={v}
                  onClick={() => { setVariant(v); setSelectedDensity(null); }}
                  className="subtab"
                  style={variant === v ? {
                    background: 'var(--dark)',
                    color: '#fff',
                    border: '1px solid var(--dark)',
                  } : {
                    background: '#fff',
                    color: 'var(--muted)',
                    border: '1px solid var(--border)',
                  }}
                >
                  {v === 'suntek' ? 'Suntek baseline' : 'Manav & KG (Feb)'}
                </button>
              ))}
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="dt w-full">
              <thead>
                <tr>
                  <th>Density</th>
                  <th className="text-right">NP / kg CP</th>
                  <th className="text-right">Waxol / kg CP</th>
                  <th className="text-right">Cl₂ / kg CP</th>
                  <th className="text-right">HCL produced</th>
                  <th className="text-right">Last variance</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.map(row => {
                  const isSelected = selectedDensity === row.d;
                  return (
                    <tr
                      key={row.d}
                      className="cursor-pointer transition-colors"
                      style={{ background: isSelected ? 'rgba(244,118,81,0.08)' : undefined }}
                      onClick={() => setSelectedDensity(isSelected ? null : row.d)}
                    >
                      <td>
                        <span className="density-pill">{row.d}</span>
                      </td>
                      <td className="text-right font-medium">{row.np}</td>
                      <td className="text-right text-slate-500">{row.wx}</td>
                      <td className="text-right font-medium">{row.cl}</td>
                      <td className="text-right font-medium">{row.hcl} kg</td>
                      <td className="text-right">
                        <span style={{ color: varianceColor(row.vr), fontWeight: 700 }}>
                          {row.vr >= 0 ? '+' : ''}{row.vr.toFixed(1)}%
                        </span>
                      </td>
                      <td>
                        {row.ok ? (
                          <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: '#DCFCE7', color: '#16A34A' }}>
                            in tolerance
                          </span>
                        ) : (
                          <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: '#FEE2E2', color: '#DC2626' }}>
                            flag
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="text-[11px] text-slate-400 mt-4">
            Click a density row to inspect its full coefficient breakdown →
          </div>
        </div>

        {/* Inline detail panel — appears when a row is selected */}
        {selectedRow && (
          <div className="col-span-12 lg:col-span-4 card p-6">
            <div className="flex items-start justify-between mb-5">
              <div>
                <div className="text-[10px] font-bold tracking-[0.18em] text-slate-400 uppercase mb-1">
                  {variant === 'suntek' ? 'Suntek baseline' : 'Manav & KG (Feb)'}
                </div>
                <div className="flex items-center gap-2">
                  <span className="density-pill text-lg px-3 py-1">{selectedRow.d}</span>
                  <span
                    className="text-xs font-semibold px-2 py-0.5 rounded-full"
                    style={selectedRow.ok
                      ? { background: '#DCFCE7', color: '#16A34A' }
                      : { background: '#FEE2E2', color: '#DC2626' }
                    }
                  >
                    {selectedRow.ok ? 'in tolerance' : 'flagged'}
                  </span>
                </div>
              </div>
              <button
                className="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors shrink-0"
                onClick={() => setSelectedDensity(null)}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M18 6 6 18M6 6l12 12"/>
                </svg>
              </button>
            </div>

            {/* Coefficient cards */}
            <div className="space-y-3">
              {[
                { label: 'NP per kg CP', value: selectedRow.np, icon: '🧪', desc: 'Normal paraffin input' },
                { label: 'Waxol per kg CP', value: selectedRow.wx, icon: '💧', desc: 'Waxol solvent input' },
                { label: 'Cl₂ per kg CP', value: selectedRow.cl, icon: '⚗️', desc: 'Chlorine gas input' },
                { label: 'HCL produced', value: `${selectedRow.hcl} kg`, icon: '📦', desc: 'Byproduct per kg CP' },
              ].map(item => (
                <div key={item.label} className="flex items-center gap-3 p-3 bg-slate-50 rounded-2xl">
                  <div className="text-xl w-8 text-center">{item.icon}</div>
                  <div className="flex-1">
                    <div className="text-xs text-slate-500">{item.label}</div>
                    <div className="font-bold text-base num">{item.value}</div>
                    <div className="text-[10px] text-slate-400">{item.desc}</div>
                  </div>
                </div>
              ))}

              {/* Variance highlight */}
              <div
                className="flex items-center gap-3 p-3 rounded-2xl"
                style={{ background: `${varianceColor(selectedRow.vr)}18`, border: `1px solid ${varianceColor(selectedRow.vr)}33` }}
              >
                <div className="text-xl w-8 text-center">📊</div>
                <div className="flex-1">
                  <div className="text-xs text-slate-500">Last batch variance</div>
                  <div className="font-bold text-xl num" style={{ color: varianceColor(selectedRow.vr) }}>
                    {selectedRow.vr >= 0 ? '+' : ''}{selectedRow.vr.toFixed(1)}%
                  </div>
                  <div className="text-[10px] text-slate-500">
                    {Math.abs(selectedRow.vr) > 1.5
                      ? 'Outside tolerance — review batch conditions'
                      : Math.abs(selectedRow.vr) > 1
                        ? 'Near tolerance limit — monitor closely'
                        : 'Within normal range'}
                  </div>
                </div>
              </div>
            </div>

            {/* Compare note */}
            <div className="mt-4 p-3 bg-orange-50 rounded-2xl text-xs text-orange-700">
              <span className="font-semibold">Compare variant:</span>{' '}
              <button
                className="underline hover:text-orange-900"
                onClick={() => setVariant(v => v === 'suntek' ? 'manav' : 'suntek')}
              >
                Switch to {variant === 'suntek' ? 'Manav & KG' : 'Suntek baseline'}
              </button>{' '}
              to see coefficient differences for d{selectedRow.d}.
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="text-center text-[11px] text-slate-400 mt-8">
        Suntek Operations · CaratSense · v0.2 (28-Apr revision)
      </div>
    </div>
  );
}
