import React, { useState, useEffect } from 'react';
import { supabase } from '../../../lib/supabase';

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

const TYPE_STYLE: Record<string, { bg: string; color: string }> = {
  regular: { bg: '#F1F5F9', color: '#475569' },
  repair:  { bg: '#FEF3C7', color: '#D97706' },
  scrap:   { bg: '#FEE2E2', color: '#DC2626' },
};

export function Maintenance() {
  const [filter, setFilter] = useState('all');
  const [logs, setLogs] = useState<any[]>([]);

  useEffect(() => {
    async function load() {
      const { data } = await (supabase
        .from('maintenance_logs')
        .select('*, plants(name)')
        .order('date', { ascending: false }) as any);
      setLogs(data || []);
    }
    load();
  }, []);

  const list = filter === 'all' ? logs : logs.filter(m => m.type === filter);

  return (
    <>
      {/* KPI row */}
      <div className="grid grid-cols-12 gap-5 mb-5">
        <div className="col-span-12 lg:col-span-3 card p-5">
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">Open maintenance</div>
          <div className="text-[28px] font-extrabold mt-1 num">{logs.filter(m => m.status === 'open').length}</div>
          <div className="text-[11px] text-slate-500 mt-1">across all plants</div>
        </div>
        <div className="col-span-12 lg:col-span-3 card p-5">
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">Repair queue</div>
          <div className="text-[28px] font-extrabold mt-1 num text-amber-600">{logs.filter(m => m.type === 'repair' && m.status === 'open').length}</div>
          <div className="text-[11px] text-amber-600 mt-1">open repair logs</div>
        </div>
        <div className="col-span-12 lg:col-span-3 card p-5">
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">Scrap items</div>
          <div className="text-[28px] font-extrabold mt-1 num text-red-600">{logs.filter(m => m.type === 'scrap').length}</div>
          <div className="text-[11px] text-red-600 mt-1">flagged for disposal</div>
        </div>
        <div className="col-span-12 lg:col-span-3 card p-5">
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">Closed</div>
          <div className="text-[28px] font-extrabold mt-1 num">{logs.filter(m => m.status === 'closed').length}</div>
          <div className="text-[11px] text-green-600 mt-1">completed</div>
        </div>
      </div>

      {/* Table — amber-soft */}
      <div className="card p-6" style={{ background: 'var(--amber-soft)', border: '1px solid #fde68a' }}>
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div>
            <div className="text-base font-bold">Maintenance log</div>
            <div className="text-xs text-slate-500">Common regular format · varies only by equipment count per factory</div>
          </div>
          <div className="flex gap-2">
            {['all','regular','repair','scrap'].map(f => (
              <div
                key={f}
                className={`chip${filter === f ? ' active' : ''}`}
                onClick={() => setFilter(f)}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </div>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto scroll-x">
          <table className="dt">
            <thead>
              <tr>
                <th>Date</th><th>Plant</th><th>Equipment</th><th>Issue</th>
                <th>Action taken</th><th>Type</th><th>Done by</th><th>Pic</th>
              </tr>
            </thead>
            <tbody>
              {list.map((m, i) => {
                const ts = TYPE_STYLE[m.type] || TYPE_STYLE.regular;
                return (
                  <tr key={m.id || i} style={{ cursor: 'pointer' }}>
                    <td className="text-slate-500 text-xs">{m.date}</td>
                    <td>{m.plants?.name || '—'}</td>
                    <td className="font-semibold">{m.equipment}</td>
                    <td className="text-slate-500">{m.issue}</td>
                    <td>{m.action || '—'}</td>
                    <td>
                      <span className="badge" style={{ background: ts.bg, color: ts.color }}>
                        {m.type?.toUpperCase()}
                      </span>
                    </td>
                    <td className="text-slate-500">{m.done_by || '—'}</td>
                    <td><PicBadge has={!!m.photo_url} /></td>
                  </tr>
                );
              })}
              {list.length === 0 && (
                <tr><td colSpan={8} className="text-center text-slate-400 py-6 text-sm">No maintenance logs yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
