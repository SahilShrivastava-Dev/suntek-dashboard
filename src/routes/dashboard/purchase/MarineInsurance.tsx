import React from 'react';
import { MARINE_LEDGER } from '../../../data/mockData';

export function MarineInsurance() {
  return (
    <>
      {/* Balance + stats */}
      <div className="grid grid-cols-12 gap-5 mb-5">
        <div className="col-span-12 lg:col-span-6 card p-6" style={{ background: 'var(--red-soft)', border: '1px solid #fecaca' }}>
          <div className="flex items-start justify-between">
            <div>
              <div className="text-xs text-slate-500 mb-1">Marine insurance balance</div>
              <div className="text-3xl font-extrabold num">
                ₹ 9.50 Cr{' '}
                <span className="text-base font-medium text-slate-400">/ ₹10 Cr</span>
              </div>
            </div>
            <div className="w-12 h-12 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 22s8-4 8-12V4l-8-2-8 2v6c0 8 8 12 8 12z"/>
              </svg>
            </div>
          </div>
          <div className="progress mt-3 mb-1"><div style={{ width: '95%' }}></div></div>
          <div className="flex items-center justify-between text-xs text-slate-500 mb-3">
            <span>Threshold ₹1 Cr</span>
            <span className="font-semibold text-slate-700">95% remaining</span>
          </div>
          <div className="font-semibold text-sm">Auto-deduct: live</div>
          <div className="text-xs text-slate-500 mb-3">
            Every supplier dispatch deducts. Top-up alert fires on threshold breach.
          </div>
          <div className="flex gap-2">
            <button className="btn-accent pill px-4 py-2 font-semibold text-sm">Top up</button>
            <button className="btn-outline pill px-4 py-2 font-semibold text-sm">View ledger</button>
          </div>
        </div>
        <div className="col-span-12 lg:col-span-3 card p-5">
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">Top-ups this FY</div>
          <div className="text-[28px] font-extrabold mt-1 num">2</div>
          <div className="text-[11px] text-slate-500 mt-1">last on 18 Mar</div>
        </div>
        <div className="col-span-12 lg:col-span-3 card p-5">
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">Avg deduction / dispatch</div>
          <div className="text-[28px] font-extrabold mt-1 num">₹ 16 L</div>
          <div className="text-[11px] text-slate-500 mt-1">31 dispatches MTD</div>
        </div>
      </div>

      {/* Ledger table */}
      <div className="card p-6">
        <div className="text-base font-bold mb-3">Recent ledger</div>
        <div className="overflow-x-auto scroll-x">
          <table className="dt">
            <thead>
              <tr>
                <th>Date</th><th>Type</th><th>Reference</th>
                <th className="num">Amount</th><th className="num">Balance</th>
              </tr>
            </thead>
            <tbody>
              {MARINE_LEDGER.map((l, i) => (
                <tr key={i}>
                  <td className="text-slate-500">{l.date}</td>
                  <td>
                    {l.t === 'top-up'
                      ? <span className="badge" style={{ background: '#DCFCE7', color: '#16A34A' }}>TOP-UP</span>
                      : <span className="badge" style={{ background: '#FEE2E2', color: '#DC2626' }}>DEDUCT</span>
                    }
                  </td>
                  <td>{l.ref}</td>
                  <td className="num font-semibold" style={{ color: l.amt > 0 ? '#16A34A' : '#DC2626' }}>
                    {l.amt > 0 ? '+' : ''}₹ {Math.abs(l.amt)} L
                  </td>
                  <td className="num">₹ {l.bal} Cr</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
