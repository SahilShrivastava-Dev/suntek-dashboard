import React from 'react';
import { ACTIVITY } from '../../../data/mockData';

function PicBadge({ has }: { has: boolean }) {
  return (
    <span className={`pic-badge${has ? '' : ' missing'}`} title={has ? 'Pic on file' : 'No pic yet'}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
        <circle cx="12" cy="13" r="4"/>
      </svg>
    </span>
  );
}

export function ActivityLog() {
  return (
    <>
      {/* KPI row */}
      <div className="grid grid-cols-12 gap-5 mb-5">
        <div className="col-span-12 lg:col-span-3 card p-5">
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">Activities · this week</div>
          <div className="text-[28px] font-extrabold mt-1 num">14</div>
          <div className="text-[11px] text-slate-500 mt-1">non-maintenance</div>
        </div>
        <div className="col-span-12 lg:col-span-3 card p-5">
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">Verified</div>
          <div className="text-[28px] font-extrabold mt-1 num text-green-600">11</div>
        </div>
        <div className="col-span-12 lg:col-span-3 card p-5">
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">Pending verification</div>
          <div className="text-[28px] font-extrabold mt-1 num text-amber-600">3</div>
        </div>
        <div className="col-span-12 lg:col-span-3 card p-5">
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">With photo proof</div>
          <div className="text-[28px] font-extrabold mt-1 num">100%</div>
          <div className="text-[11px] text-slate-500 mt-1">all in OneDrive</div>
        </div>
      </div>

      {/* Table — amber-soft */}
      <div className="card p-6" style={{ background: 'var(--amber-soft)', border: '1px solid #fde68a' }}>
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div>
            <div className="text-base font-bold">Activity log book</div>
            <div className="text-xs text-slate-500">Anything outside the regular maintenance schedule · photos saved to OneDrive</div>
          </div>
          <button className="btn-accent pill px-4 py-2 font-semibold text-sm">+ Log activity</button>
        </div>
        <div className="overflow-x-auto scroll-x">
          <table className="dt">
            <thead>
              <tr>
                <th>Equipment</th><th>Type</th><th>Date</th>
                <th>Done by</th><th>Verified by</th><th>Plant</th><th>Pic</th>
              </tr>
            </thead>
            <tbody>
              {ACTIVITY.map((a, i) => (
                <tr key={i} style={{ cursor: 'pointer' }}>
                  <td className="font-semibold">{a.eq}</td>
                  <td className="text-slate-500">{a.type}</td>
                  <td className="text-slate-500 text-xs">{a.date}</td>
                  <td>{a.by}</td>
                  <td className="text-slate-500">{a.ver}</td>
                  <td>{a.plant}</td>
                  <td><PicBadge has={a.pic} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
