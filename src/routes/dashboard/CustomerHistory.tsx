import React, { useState } from 'react';
import { CUSTOMERS, SAMARTH_HISTORY, SAMARTH_DENSITY } from '../../data/mockData';

const maxBar = Math.max(...SAMARTH_HISTORY.map(s => s.d));

export function CustomerHistory() {
  const [search, setSearch] = useState('');

  const filtered = CUSTOMERS.filter(c =>
    !search || c.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <>
      {/* KPIs */}
      <div className="grid grid-cols-12 gap-5 mb-5">
        <div className="col-span-12 lg:col-span-3 card p-5">
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">Active customers</div>
          <div className="text-[28px] font-extrabold mt-1 num">42</div>
          <div className="text-[11px] text-slate-500 mt-1">past 12 months</div>
        </div>
        <div className="col-span-12 lg:col-span-3 card p-5">
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">Top customer · MTD</div>
          <div className="text-[20px] font-extrabold mt-1">Samarth Polymers</div>
          <div className="text-[11px] text-slate-500 mt-1">₹ 36.1 L · 425 drums</div>
        </div>
        <div className="col-span-12 lg:col-span-3 card p-5">
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">Avg order size</div>
          <div className="text-[28px] font-extrabold mt-1 num">22 drums</div>
        </div>
        <div className="col-span-12 lg:col-span-3 card p-5">
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">Overdue payments</div>
          <div className="text-[28px] font-extrabold mt-1 num text-amber-600">3</div>
          <div className="text-[11px] text-amber-600 mt-1">₹ 8.6 L total</div>
        </div>
      </div>

      {/* Customer ledger — green-soft */}
      <div className="card p-6 mb-5" style={{ background: 'var(--green-soft)', border: '1px solid #bbf7d0' }}>
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div>
            <div className="text-base font-bold">Customer ledger</div>
            <div className="text-xs text-slate-500">Click a customer for full history · density preferences · payment trail</div>
          </div>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search customer …"
            className="px-4 py-2 bg-slate-50 rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-orange-200"
          />
        </div>
        <div className="overflow-x-auto scroll-x">
          <table className="dt">
            <thead>
              <tr>
                <th>Customer</th><th>Place</th><th>Pref. density</th>
                <th className="num">Drums · MTD</th><th className="num">Value · MTD</th>
                <th className="num">Last 12mo</th><th className="num">Avg order</th>
                <th className="num">Outstanding</th><th>Trend</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => (
                <tr key={c.name} style={{ cursor: 'pointer' }}>
                  <td className="font-semibold">{c.name}</td>
                  <td className="text-slate-500">{c.place}</td>
                  <td><span className="density-pill">{c.density}</span></td>
                  <td className="num">{c.mtdQty}</td>
                  <td className="num font-bold">₹ {c.mtdVal}</td>
                  <td className="num text-slate-500">₹ {c.y12}</td>
                  <td className="num text-slate-500">{c.avgOrd}</td>
                  <td className={`num font-semibold ${c.out !== '0' ? 'text-amber-600' : 'text-slate-400'}`}>
                    {c.out === '0' ? '—' : `₹ ${c.out}`}
                  </td>
                  <td>
                    <span className={`font-semibold ${c.trend > 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {c.trend > 0 ? '↑' : '↓'} {Math.abs(c.trend)}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-12 gap-5">
        <div className="col-span-12 lg:col-span-6 card p-6">
          <div className="text-base font-bold">Samarth Polymers · last 6 months</div>
          <div className="text-xs text-slate-500 mb-4">Drums dispatched per month</div>
          <div className="space-y-2">
            {SAMARTH_HISTORY.map(s => (
              <div key={s.m} className="flex items-center gap-3">
                <div className="w-10 text-[11px] text-slate-500 font-semibold">{s.m}</div>
                <div className="flex-1 progress" style={{ height: '14px' }}>
                  <div style={{ width: `${s.d / maxBar * 100}%`, background: 'linear-gradient(90deg,#F47651,#FF8A66)' }}></div>
                </div>
                <div className="w-12 text-right text-sm font-bold num">{s.d}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="col-span-12 lg:col-span-6 card p-6">
          <div className="text-base font-bold">Density preference</div>
          <div className="text-xs text-slate-500 mb-4">Where their volume sits</div>
          <div className="space-y-2">
            {SAMARTH_DENSITY.map(d => (
              <div key={d.d} className="flex items-center gap-3">
                <div className="w-14"><span className="density-pill">{d.d}</span></div>
                <div className="flex-1 progress" style={{ height: '14px' }}>
                  <div style={{ width: `${d.pct}%` }}></div>
                </div>
                <div className="w-10 text-right text-sm font-bold num">{d.pct}%</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
