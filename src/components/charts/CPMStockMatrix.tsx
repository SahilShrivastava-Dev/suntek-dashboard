import React from 'react';
import { clsx } from 'clsx';
import { CP_LOCATIONS, CP_DENSITIES, CP_MATRIX } from '../../data/mockData';
import { clamp } from '../../lib/utils/formatting';

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
  // Column totals
  const colTotals = CP_DENSITIES.map((d) =>
    CP_LOCATIONS.reduce((sum, p) => {
      const idx = CP_DENSITIES.indexOf(d);
      return sum + (CP_MATRIX[p]?.[idx] ?? 0);
    }, 0)
  );

  // Row totals
  const rowTotals = CP_LOCATIONS.map((p) =>
    CP_DENSITIES.reduce((sum, d) => {
      const idx = CP_DENSITIES.indexOf(d);
      return sum + (CP_MATRIX[p]?.[idx] ?? 0), 0;
    }, 0)
  );

  // Re-calculate row totals and grand total correctly
  const calculatedRowTotals = CP_LOCATIONS.map((p) => {
    return (CP_MATRIX[p] || []).reduce((sum: number, val: number) => sum + val, 0);
  });
  const grandTotal = calculatedRowTotals.reduce((a: number, b: number) => a + b, 0);

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 shadow-sm">
      <table className="text-xs border-collapse min-w-full">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            <th className="px-3 py-2 text-left font-semibold text-gray-600 sticky left-0 bg-gray-50 min-w-[120px]">
              Plant / Density
            </th>
            {CP_DENSITIES.map((d) => (
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
          {CP_LOCATIONS.map((plant: string, pi: number) => (
            <tr key={plant} className="border-b border-gray-100 last:border-0">
              <td className="px-3 py-1.5 font-medium text-gray-700 sticky left-0 bg-white whitespace-nowrap">
                {plant}
              </td>
              {CP_DENSITIES.map((density: number) => {
                const idx = CP_DENSITIES.indexOf(density);
                const qty = CP_MATRIX[plant]?.[idx] ?? 0;
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
                {calculatedRowTotals[pi]}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-gray-100 border-t-2 border-gray-300">
            <td className="px-3 py-1.5 font-bold text-gray-700 sticky left-0 bg-gray-100">
              Total
            </td>
            {colTotals.map((total: number, i: number) => (
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
