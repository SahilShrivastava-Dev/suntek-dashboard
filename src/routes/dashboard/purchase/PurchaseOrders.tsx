import React, { useState } from 'react';
import { REQUIREMENTS } from '../../../data/mockData';
import { exportToXlsx } from '../../../lib/utils/exportXlsx';
import { useRoleContext } from '../../../contexts/RoleContext';

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

const STATUS_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  approved:   { bg: '#FEF3C7', color: '#D97706', label: 'APPROVED'   },
  dispatched: { bg: '#DCFCE7', color: '#16A34A', label: 'DISPATCHED' },
  received:   { bg: '#DBEAFE', color: '#2563EB', label: 'RECEIVED'   },
};

const KIND_STYLE: Record<string, { bg: string; color: string }> = {
  'small':    { bg: '#F1F5F9', color: '#475569' },
  'PO':       { bg: '#EDE9FE', color: '#7C3AED' },
  'PO (FAR)': { bg: '#FFEDE5', color: '#C5421F' },
};

export function PurchaseOrders() {
  const [filter, setFilter] = useState('all');
  const { activeProfile } = useRoleContext();

  function handleExport() {
    const rows = (filter === 'all' ? REQUIREMENTS : REQUIREMENTS.filter(r => r.status === filter));
    exportToXlsx(
      rows.map(r => ({ id: r.id, material: r.mat, type: r.kind, supplier: r.sup, destination: r.dest, quantity: r.qty, value: r.val, status: r.status })),
      [
        { header: 'REQ #', key: 'id' },
        { header: 'Material / Asset', key: 'material' },
        { header: 'Type', key: 'type' },
        { header: 'Supplier', key: 'supplier' },
        { header: 'Destination', key: 'destination' },
        { header: 'Qty', key: 'quantity' },
        { header: 'Value', key: 'value' },
        { header: 'Status', key: 'status' },
      ],
      'purchase-orders',
      activeProfile,
      'Purchase Orders',
    );
  }

  const list = filter === 'all'
    ? REQUIREMENTS
    : REQUIREMENTS.filter(r => r.status === filter);

  return (
    <>
      {/* KPI row */}
      <div className="grid grid-cols-12 gap-5 mb-5">
        <div className="col-span-12 lg:col-span-3 card p-5">
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">Spent · this month</div>
          <div className="text-[28px] font-extrabold mt-1 num">₹ 38.42 L</div>
          <div className="text-[11px] text-green-600 mt-1">↓ 4.1% vs Mar</div>
        </div>
        <div className="col-span-12 lg:col-span-3 card p-5">
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">PO required</div>
          <div className="text-[28px] font-extrabold mt-1 num">5</div>
          <div className="text-[11px] text-slate-500 mt-1">on Fixed Assets</div>
        </div>
        <div className="col-span-12 lg:col-span-3 card p-5">
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">Auth-only (small)</div>
          <div className="text-[28px] font-extrabold mt-1 num">7</div>
          <div className="text-[11px] text-slate-500 mt-1">no PO needed</div>
        </div>
        <div className="col-span-12 lg:col-span-3 card p-5">
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">Avg lead time</div>
          <div className="text-[28px] font-extrabold mt-1 num">3.2 d</div>
        </div>
      </div>

      {/* Table — red-soft */}
      <div className="card p-6" style={{ background: 'var(--red-soft)', border: '1px solid #fecaca' }}>
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div>
            <div className="text-base font-bold">Purchase orders</div>
            <div className="text-xs text-slate-500">PO created in Busy (supporting platform) · small reqs use Vijay Ji authorisation only</div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {[
              { val: 'all', label: 'All' },
              { val: 'approved', label: 'Approved' },
              { val: 'dispatched', label: 'Dispatched' },
              { val: 'received', label: 'Received' },
            ].map(f => (
              <div
                key={f.val}
                className={`chip${filter === f.val ? ' active' : ''}`}
                onClick={() => setFilter(f.val)}
              >
                {f.label}
                {f.val === 'all' && <span className="ml-1 text-slate-400">12</span>}
              </div>
            ))}
            <button
              className="btn-ghost pill px-4 py-2 font-semibold text-sm flex items-center gap-2"
              onClick={handleExport}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              Export
            </button>
            <button className="btn-accent pill px-4 py-2 font-semibold text-sm">+ New PO</button>
          </div>
        </div>
        <div className="overflow-x-auto scroll-x">
          <table className="dt">
            <thead>
              <tr>
                <th>REQ #</th><th>Material / Asset</th><th>Type</th><th>Supplier</th>
                <th>Destination</th><th className="num">Qty</th><th className="num">Value</th>
                <th>Status</th><th>Pic</th>
              </tr>
            </thead>
            <tbody>
              {list.map(r => {
                const ks = KIND_STYLE[r.kind] || KIND_STYLE.small;
                const ss = STATUS_STYLE[r.status];
                return (
                  <tr key={r.id} style={{ cursor: 'pointer' }}>
                    <td className="font-semibold text-slate-700">{r.id}</td>
                    <td>{r.mat}</td>
                    <td>
                      <span className="badge" style={{ background: ks.bg, color: ks.color }}>
                        {r.kind.toUpperCase()}
                      </span>
                    </td>
                    <td className="text-slate-500">{r.sup}</td>
                    <td>{r.dest}</td>
                    <td className="num">{r.qty}</td>
                    <td className="num font-semibold">{r.val}</td>
                    <td>
                      <span className="badge" style={{ background: ss.bg, color: ss.color }}>
                        {ss.label}
                      </span>
                    </td>
                    <td><PicBadge has={r.pic} /></td>
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
