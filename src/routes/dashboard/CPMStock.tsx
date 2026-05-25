import React, { useState } from 'react';
import { TANKS, CP_LOCATIONS, CP_DENSITIES, CP_MATRIX, STORE_ITEMS } from '../../data/mockData';

interface BulkRow {
  item: string;
  adjustment: string;
  direction: 'in' | 'out';
  note: string;
}

export function CPMStock() {
  const [storeSearch, setStoreSearch] = useState('');
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkRows, setBulkRows] = useState<BulkRow[]>([
    { item: '', adjustment: '', direction: 'in', note: '' },
  ]);
  const [bulkSaved, setBulkSaved] = useState(false);

  const filteredItems = STORE_ITEMS.filter(i =>
    !storeSearch || i.item.toLowerCase().includes(storeSearch.toLowerCase())
  );

  function addBulkRow() {
    setBulkRows(r => [...r, { item: '', adjustment: '', direction: 'in', note: '' }]);
  }

  function removeBulkRow(idx: number) {
    setBulkRows(r => r.filter((_, i) => i !== idx));
  }

  function updateBulkRow(idx: number, field: keyof BulkRow, value: string) {
    setBulkRows(r => r.map((row, i) => i === idx ? { ...row, [field]: value } : row));
  }

  function handleBulkSave() {
    const filled = bulkRows.filter(r => r.item.trim() && r.adjustment);
    if (filled.length === 0) return;
    setBulkSaved(true);
    setTimeout(() => {
      setShowBulkModal(false);
      setBulkSaved(false);
      setBulkRows([{ item: '', adjustment: '', direction: 'in', note: '' }]);
    }, 1400);
  }

  function handleCloseBulkModal() {
    setShowBulkModal(false);
    setBulkSaved(false);
    setBulkRows([{ item: '', adjustment: '', direction: 'in', note: '' }]);
  }

  return (
    <>
      {/* KPIs */}
      <div className="grid grid-cols-12 gap-5 mb-5">
        <div className="col-span-12 lg:col-span-3 card p-5">
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">CP drums total</div>
          <div className="text-[28px] font-extrabold mt-1 num">1 450</div>
          <div className="text-[11px] text-slate-500 mt-1">across godowns</div>
        </div>
        <div className="col-span-12 lg:col-span-3 card p-5">
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">HCL stock</div>
          <div className="text-[28px] font-extrabold mt-1 num">480 MT</div>
          <div className="text-[11px] text-slate-500 mt-1">at gravities 1.05-2.4</div>
        </div>
        <div className="col-span-12 lg:col-span-3 card p-5">
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">Below threshold</div>
          <div className="text-[28px] font-extrabold mt-1 num text-red-600">12 SKUs</div>
        </div>
        <div className="col-span-12 lg:col-span-3 card p-5">
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">Tank capacity</div>
          <div className="text-[28px] font-extrabold mt-1 num">68%</div>
          <div className="progress mt-2"><div style={{ width: '68%' }}></div></div>
        </div>
      </div>

      {/* Matrix + Tanks */}
      <div className="grid grid-cols-12 gap-5 mb-5">
        <div className="col-span-12 lg:col-span-7 card p-6">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-base font-bold">CP density × location</div>
              <div className="text-xs text-slate-500">Drums on hand · cell shading shows volume</div>
            </div>
          </div>
          <div className="overflow-x-auto scroll-x">
            <table className="dt">
              <thead>
                <tr>
                  <th>Location</th>
                  {CP_DENSITIES.map(d => <th key={d} className="num">d {d}</th>)}
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {CP_LOCATIONS.map(loc => {
                  const row = CP_MATRIX[loc];
                  const total = row.reduce((a, b) => a + b, 0);
                  return (
                    <tr key={loc}>
                      <td className="font-semibold">{loc}</td>
                      {row.map((v, i) => {
                        const intensity = Math.min(v / 400, 1);
                        return (
                          <td key={i} className="num">
                            <span style={{ background: `rgba(244,118,81,${intensity * 0.28})`, padding: '3px 10px', borderRadius: '8px' }}>
                              {v}
                            </span>
                          </td>
                        );
                      })}
                      <td className="num font-bold">{total}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="col-span-12 lg:col-span-5 card p-6">
          <div className="text-base font-bold">Tank levels · port + factory</div>
          <div className="text-xs text-slate-500 mb-4">Pictorial only — capacity bars per tank</div>
          <div className="space-y-3">
            {TANKS.map(tk => {
              const color = tk.alert ? '#DC2626' : tk.level > 70 ? '#16A34A' : tk.level > 30 ? '#F47651' : '#D97706';
              return (
                <div key={tk.name} className="p-3 rounded-2xl border border-slate-100 hover:bg-slate-50">
                  <div className="flex items-center justify-between mb-1.5">
                    <div>
                      <div className="font-semibold text-sm">{tk.name}</div>
                      <div className="text-[11px] text-slate-500">{tk.loc} · cap {tk.cap} {tk.unit}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold num text-sm">{Math.round(tk.cap * tk.level / 100)} {tk.unit}</div>
                      <div className="text-[11px] font-semibold" style={{ color }}>
                        {tk.level}%{tk.alert ? ' · low' : ''}
                      </div>
                    </div>
                  </div>
                  <div className="progress" style={{ height: '6px' }}>
                    <div style={{ width: `${tk.level}%`, background: color }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Store items — green-soft */}
      <div className="card p-6" style={{ background: 'var(--green-soft)', border: '1px solid #bbf7d0' }}>
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div>
            <div className="text-base font-bold">Store items · 400+ SKUs</div>
            <div className="text-xs text-slate-500">Per-item thresholds · alerts auto-fire on breach</div>
          </div>
          <div className="flex items-center gap-2">
            <input
              value={storeSearch}
              onChange={e => setStoreSearch(e.target.value)}
              placeholder="Search item …"
              className="px-4 py-2 bg-slate-50 rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-orange-200"
            />
            <button
              className="chip hover:bg-slate-200 transition-colors cursor-pointer"
              onClick={() => setShowBulkModal(true)}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 5v14M5 12h14"/>
              </svg>
              Bulk update
            </button>
          </div>
        </div>
        <div className="overflow-x-auto scroll-x">
          <table className="dt">
            <thead>
              <tr>
                <th>Item</th><th>Location</th><th className="num">Opening</th>
                <th className="num">In</th><th className="num">Out</th>
                <th className="num">Closing</th><th className="num">Threshold</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map(i => {
                const breach = i.cl < i.th;
                return (
                  <tr key={i.item} style={{ cursor: 'pointer' }}>
                    <td className="font-semibold">{i.item}</td>
                    <td>{i.loc}</td>
                    <td className="num text-slate-500">{i.op}</td>
                    <td className="num text-green-600">+{i.inn}</td>
                    <td className="num text-red-600">-{i.out}</td>
                    <td className="num font-bold">
                      {i.cl} <span className="text-[10px] text-slate-400">{i.unit}</span>
                    </td>
                    <td className="num text-slate-500">{i.th}</td>
                    <td>
                      {breach
                        ? <span className="badge" style={{ background: '#FEE2E2', color: '#DC2626' }}>BELOW</span>
                        : <span className="badge" style={{ background: '#DCFCE7', color: '#16A34A' }}>OK</span>
                      }
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Bulk Update Modal ── */}
      {showBulkModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(4px)' }}
          onClick={e => { if (e.target === e.currentTarget) handleCloseBulkModal(); }}
        >
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-xl p-7 relative">
            {/* Header */}
            <div className="flex items-start justify-between mb-5">
              <div>
                <div className="text-[11px] text-slate-400 uppercase tracking-wider mb-1">CPM Stock · Store Items</div>
                <div className="text-xl font-bold">Bulk stock update</div>
                <div className="text-xs text-slate-500 mt-1">Add multiple stock movements at once · each row is one item</div>
              </div>
              <button
                className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center shrink-0 ml-4 transition-colors"
                onClick={handleCloseBulkModal}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M18 6 6 18M6 6l12 12"/>
                </svg>
              </button>
            </div>

            {bulkSaved ? (
              <div className="text-center py-8">
                <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-3">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#16A34A" strokeWidth="2.5">
                    <path d="M20 6 9 17l-5-5"/>
                  </svg>
                </div>
                <div className="font-semibold text-green-700">Stock updated</div>
                <div className="text-xs text-slate-500 mt-1">Ledger entries created · alerts re-evaluated…</div>
              </div>
            ) : (
              <>
                {/* Column headers */}
                <div className="grid grid-cols-[2fr_1fr_80px_2fr_24px] gap-2 mb-2 px-1">
                  <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Item name</div>
                  <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Qty</div>
                  <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">In / Out</div>
                  <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Note</div>
                  <div />
                </div>

                {/* Rows */}
                <div className="space-y-2 mb-4 max-h-[280px] overflow-y-auto pr-1">
                  {bulkRows.map((row, idx) => (
                    <div key={idx} className="grid grid-cols-[2fr_1fr_80px_2fr_24px] gap-2 items-center">
                      <input
                        value={row.item}
                        onChange={e => updateBulkRow(idx, 'item', e.target.value)}
                        placeholder="NC Thinner…"
                        className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-200 transition"
                      />
                      <input
                        type="number"
                        value={row.adjustment}
                        onChange={e => updateBulkRow(idx, 'adjustment', e.target.value)}
                        placeholder="5"
                        className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-200 transition"
                      />
                      <div className="flex rounded-xl overflow-hidden border border-slate-200 text-xs font-semibold">
                        <button
                          onClick={() => updateBulkRow(idx, 'direction', 'in')}
                          className={`flex-1 py-2 transition-colors ${row.direction === 'in' ? 'bg-green-500 text-white' : 'bg-slate-50 text-slate-500 hover:bg-slate-100'}`}
                        >
                          IN
                        </button>
                        <button
                          onClick={() => updateBulkRow(idx, 'direction', 'out')}
                          className={`flex-1 py-2 transition-colors ${row.direction === 'out' ? 'bg-red-500 text-white' : 'bg-slate-50 text-slate-500 hover:bg-slate-100'}`}
                        >
                          OUT
                        </button>
                      </div>
                      <input
                        value={row.note}
                        onChange={e => updateBulkRow(idx, 'note', e.target.value)}
                        placeholder="reason…"
                        className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-200 transition"
                      />
                      <button
                        onClick={() => bulkRows.length > 1 ? removeBulkRow(idx) : undefined}
                        className="w-6 h-6 rounded-full bg-slate-100 hover:bg-red-100 hover:text-red-500 flex items-center justify-center transition-colors"
                        style={{ opacity: bulkRows.length === 1 ? 0.3 : 1, cursor: bulkRows.length === 1 ? 'default' : 'pointer' }}
                      >
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M18 6 6 18M6 6l12 12"/>
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>

                {/* Add row */}
                <button
                  className="text-orange-600 text-xs font-semibold flex items-center gap-1.5 hover:gap-2 transition-all mb-5"
                  onClick={addBulkRow}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M12 5v14M5 12h14"/>
                  </svg>
                  Add another item
                </button>

                {/* Actions */}
                <div className="flex gap-3">
                  <button className="btn-ghost pill flex-1 py-3 font-semibold text-sm" onClick={handleCloseBulkModal}>
                    Cancel
                  </button>
                  <button
                    className="btn-accent pill flex-1 py-3 font-semibold text-sm"
                    disabled={!bulkRows.some(r => r.item.trim() && r.adjustment)}
                    onClick={handleBulkSave}
                    style={{ opacity: !bulkRows.some(r => r.item.trim() && r.adjustment) ? 0.5 : 1 }}
                  >
                    Save {bulkRows.filter(r => r.item.trim() && r.adjustment).length || ''} update{bulkRows.filter(r => r.item.trim() && r.adjustment).length !== 1 ? 's' : ''}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
