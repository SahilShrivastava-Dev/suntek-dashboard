import React from 'react';
import { LABOUR_PLANTS } from '../../../data/mockData';

export function Labour() {
  return (
    <>
      {/* KPI row */}
      <div className="grid grid-cols-12 gap-5 mb-5">
        <div className="col-span-12 lg:col-span-3 card p-5">
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">Today's labour cost</div>
          <div className="text-[28px] font-extrabold mt-1 num">₹ 2,84,500</div>
        </div>
        <div className="col-span-12 lg:col-span-3 card p-5">
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">MTD</div>
          <div className="text-[28px] font-extrabold mt-1 num">₹ 71,12,400</div>
          <div className="text-[11px] text-amber-600 mt-1">↑ 3.2% vs Mar</div>
        </div>
        <div className="col-span-12 lg:col-span-3 card p-5">
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">Per-MT cost</div>
          <div className="text-[28px] font-extrabold mt-1 num">₹ 1 487</div>
          <div className="text-[11px] text-slate-500 mt-1">target ₹ 1 450</div>
        </div>
        <div className="col-span-12 lg:col-span-3 card p-5">
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">Variance flagged</div>
          <div className="text-[28px] font-extrabold mt-1 num text-amber-600">2 plants</div>
        </div>
      </div>

      {/* Per-plant table — green-soft */}
      <div className="card p-6 mb-5" style={{ background: 'var(--green-soft)', border: '1px solid #bbf7d0' }}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-base font-bold">Per-plant labour · today</div>
            <div className="text-xs text-slate-500">
              Auto-derived from purchase qty × sales qty (sales feeds it automatically)
            </div>
          </div>
          <button className="btn-outline pill px-3 py-2 text-xs font-semibold">Edit formula</button>
        </div>
        <div className="overflow-x-auto scroll-x">
          <table className="dt">
            <thead>
              <tr>
                <th>Plant</th>
                <th className="num">Purchase qty</th>
                <th className="num">Sales qty</th>
                <th className="num">Batches</th>
                <th className="num">Computed cost</th>
                <th className="num">Per MT</th>
                <th>Vs target</th>
              </tr>
            </thead>
            <tbody>
              {LABOUR_PLANTS.map(p => {
                const tColor = p.target > 0 ? '#D97706' : p.target < 0 ? '#16A34A' : '#475569';
                const tBg    = p.target > 0 ? '#FEF3C7' : p.target < 0 ? '#DCFCE7' : '#F1F5F9';
                const tLbl   = p.target > 0
                  ? `+${p.target}% over`
                  : p.target < 0
                  ? `${Math.abs(p.target)}% under`
                  : 'on target';
                return (
                  <tr key={p.plant} style={{ cursor: 'pointer' }}>
                    <td className="font-semibold">{p.plant}</td>
                    <td className="num text-slate-500">{p.pq}</td>
                    <td className="num text-slate-500">{p.sq}</td>
                    <td className="num">{p.batches}</td>
                    <td className="num font-bold">{p.cost}</td>
                    <td className="num">{p.perMT}</td>
                    <td>
                      <span className="badge" style={{ background: tBg, color: tColor }}>
                        {tLbl}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
