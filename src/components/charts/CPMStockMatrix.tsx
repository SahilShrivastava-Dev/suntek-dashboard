import React, { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { supabase } from '../../lib/supabase';
import type { Database } from '../../lib/database.types';
import { clamp } from '../../lib/utils/formatting';

type DrumRow = Database['public']['Tables']['cpm_drum_stock']['Row'];

/** Heat-map intensity: 0 = empty (white), 1 = max stock (darkest green) */
const MAX_DRUMS = 400;

function cellColor(qty: number): string {
  if (qty === 0) return 'bg-gray-50 text-gray-300';
  const intensity = clamp(qty / MAX_DRUMS, 0.1, 1);
  if (intensity >= 0.8) return 'bg-green-700 text-white font-semibold';
  if (intensity >= 0.6) return 'bg-green-600 text-white font-semibold';
  if (intensity >= 0.4) return 'bg-green-500 text-white';
  if (intensity >= 0.2) return 'bg-green-300 text-green-900';
  return 'bg-green-100 text-green-800';
}

export function CPMStockMatrix() {
  const [rows, setRows] = useState<DrumRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('cpm_drum_stock')
        .select('*')
        .returns<DrumRow[]>();
      if (!cancelled) {
        setRows(data || []);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Derive locations (sorted) and densities (ascending) from the live rows.
  const locations = [...new Set(rows.map((r) => r.location))].sort();
  const densities = [...new Set(rows.map((r) => r.density))].sort((a, b) => a - b);

  // matrix[location][density] = drums (0 if missing)
  const lookup = new Map(rows.map((r) => [`${r.location}|${r.density}`, r.drums]));
  const drumsAt = (loc: string, d: number) => lookup.get(`${loc}|${d}`) ?? 0;

  if (loading) {
    return (
      <div className="rounded-lg border border-gray-200 shadow-sm p-6 text-center text-sm text-gray-400">
        Loading…
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 shadow-sm p-8 text-center text-sm text-gray-400">
        No drum stock recorded yet.
      </div>
    );
  }

  // Column totals (per density)
  const colTotals = densities.map((d) =>
    locations.reduce((sum, loc) => sum + drumsAt(loc, d), 0)
  );
  // Row totals (per location)
  const rowTotals = locations.map((loc) =>
    densities.reduce((sum, d) => sum + drumsAt(loc, d), 0)
  );
  const grandTotal = rowTotals.reduce((a, b) => a + b, 0);

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 shadow-sm">
      <table className="text-xs border-collapse min-w-full">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            <th className="px-3 py-2 text-left font-semibold text-gray-600 sticky left-0 bg-gray-50 min-w-[120px]">
              Plant / Density
            </th>
            {densities.map((d) => (
              <th key={d} className="px-2 py-2 text-center font-semibold text-gray-600 min-w-[60px]">
                {d}
              </th>
            ))}
            <th className="px-2 py-2 text-center font-semibold text-gray-700 bg-gray-100 min-w-[60px]">
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {locations.map((plant, pi) => (
            <tr key={plant} className="border-b border-gray-100 last:border-0">
              <td className="px-3 py-1.5 font-medium text-gray-700 sticky left-0 bg-white whitespace-nowrap">
                {plant}
              </td>
              {densities.map((density) => {
                const qty = drumsAt(plant, density);
                return (
                  <td
                    key={density}
                    className={clsx('px-2 py-1.5 text-center text-xs transition-colors', cellColor(qty))}
                    title={`${plant} · density ${density}: ${qty} drums`}
                  >
                    {qty > 0 ? qty : '—'}
                  </td>
                );
              })}
              <td className="px-2 py-1.5 text-center font-semibold text-gray-800 bg-gray-50">
                {rowTotals[pi]}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-gray-100 border-t-2 border-gray-300">
            <td className="px-3 py-1.5 font-bold text-gray-700 sticky left-0 bg-gray-100">
              Total
            </td>
            {colTotals.map((total, i) => (
              <td key={i} className="px-2 py-1.5 text-center font-semibold text-gray-700">
                {total > 0 ? total : '—'}
              </td>
            ))}
            <td className="px-2 py-1.5 text-center font-bold text-gray-900">
              {grandTotal}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
