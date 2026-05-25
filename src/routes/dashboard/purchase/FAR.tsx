import React from 'react';
import { FAR as FAR_DATA } from '../../../data/mockData';

function PicBadge({ has }: { has: boolean }) {
  return (
    <span
      className={`pic-badge${has ? '' : ' missing'}`}
      title={has ? 'Pic on file' : 'No pic yet'}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
        <circle cx="12" cy="13" r="4"/>
      </svg>
    </span>
  );
}

export function FAR() {
  return (
    <>
      {/* KPI row */}
      <div className="grid grid-cols-12 gap-5 mb-5">
        <div className="col-span-12 lg:col-span-3 card p-5">
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">Total fixed assets</div>
          <div className="text-[28px] font-extrabold mt-1 num">42</div>
          <div className="text-[11px] text-slate-500 mt-1">across 4 factories</div>
        </div>
        <div className="col-span-12 lg:col-span-3 card p-5">
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">Insurance coverage</div>
          <div className="text-[28px] font-extrabold mt-1 num">₹ 38.4 Cr</div>
          <div className="text-[11px] text-green-600 mt-1">all named on FAR</div>
        </div>
        <div className="col-span-12 lg:col-span-3 card p-5">
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">Repair flagged</div>
          <div className="text-[28px] font-extrabold mt-1 num text-amber-600">3</div>
          <div className="text-[11px] text-amber-600 mt-1">awaiting closure</div>
        </div>
        <div className="col-span-12 lg:col-span-3 card p-5">
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">Pic-proof coverage</div>
          <div className="text-[28px] font-extrabold mt-1 num">95%</div>
          <div className="progress mt-2"><div style={{ width: '95%' }}></div></div>
        </div>
      </div>

      {/* FAR table — amber-soft */}
      <div className="card p-6" style={{ background: 'var(--amber-soft)', border: '1px solid #fde68a' }}>
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div>
            <div className="text-base font-bold">Fixed Asset Register</div>
            <div className="text-xs text-slate-500">Each asset is named — used in insurance · pic proof on file</div>
          </div>
          <button className="btn-accent pill px-4 py-2 font-semibold text-sm">+ Register asset</button>
        </div>
        <div className="overflow-x-auto scroll-x">
          <table className="dt">
            <thead>
              <tr>
                <th>Sl no</th>
                <th>Identification mark</th>
                <th>Model</th>
                <th className="num">Capacity</th>
                <th>Origin</th>
                <th className="num">Year</th>
                <th className="num">Taxable value</th>
                <th>Invoice no</th>
                <th>Date of purchase</th>
                <th>Account head</th>
                <th>Pic</th>
              </tr>
            </thead>
            <tbody>
              {FAR_DATA.map(f => (
                <tr key={f.id} style={{ cursor: 'pointer' }}>
                  <td className="num">{f.sl}</td>
                  <td className="font-semibold text-slate-700">{f.id}</td>
                  <td>{f.model}</td>
                  <td className="num">{f.cap}</td>
                  <td>{f.origin}</td>
                  <td className="num">{f.year}</td>
                  <td className="num font-semibold">{f.val}</td>
                  <td className="text-slate-500">{f.inv}</td>
                  <td className="text-slate-500">{f.dt}</td>
                  <td className="text-slate-500">{f.acc}</td>
                  <td><PicBadge has={f.pic} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
