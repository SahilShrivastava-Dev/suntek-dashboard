import React, { useState } from 'react';
import { CONTRACTS } from '../../data/mockData';

interface NewContractForm {
  customer: string;
  density: string;
  lockedPrice: string;
  bookedQty: string;
}

const DENSITY_OPTIONS = ['1300', '1400', '1450', '1500'];

export function Sales() {
  const [showModal, setShowModal] = useState(false);
  const [selectedContract, setSelectedContract] = useState<typeof CONTRACTS[0] | null>(null);

  const [form, setForm] = useState<NewContractForm>({
    customer: '',
    density: '1400',
    lockedPrice: '',
    bookedQty: '',
  });
  const [formSaved, setFormSaved] = useState(false);

  function handleFormChange(field: keyof NewContractForm, value: string) {
    setForm(f => ({ ...f, [field]: value }));
  }

  function handleSaveContract() {
    if (!form.customer.trim() || !form.lockedPrice || !form.bookedQty) return;
    setFormSaved(true);
    setTimeout(() => {
      setShowModal(false);
      setFormSaved(false);
      setForm({ customer: '', density: '1400', lockedPrice: '', bookedQty: '' });
    }, 1400);
  }

  function handleCloseModal() {
    setShowModal(false);
    setFormSaved(false);
    setForm({ customer: '', density: '1400', lockedPrice: '', bookedQty: '' });
  }

  return (
    <>
      {/* KPIs */}
      <div className="grid grid-cols-12 gap-5 mb-5">
        <div className="col-span-12 lg:col-span-3 card p-5">
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">CP sales · MTD</div>
          <div className="text-[28px] font-extrabold mt-1 num">₹ 1.28 Cr</div>
          <div className="text-[11px] text-green-600 mt-1">↑ 18.4%</div>
        </div>
        <div className="col-span-12 lg:col-span-3 card p-5">
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">HCL · MTD</div>
          <div className="text-[28px] font-extrabold mt-1 num">₹ 32.4 L</div>
        </div>
        <div className="col-span-12 lg:col-span-3 card p-5">
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">Open contracts</div>
          <div className="text-[28px] font-extrabold mt-1 num">28</div>
        </div>
        <div className="col-span-12 lg:col-span-3 card p-5">
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">Avg dispatch / day</div>
          <div className="text-[28px] font-extrabold mt-1 num">86</div>
        </div>
      </div>

      {/* Info banner */}
      <div className="card p-5 mb-5" style={{ background: '#FFF7E6', border: '1px solid #FCD9C5' }}>
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center shrink-0">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>
            </svg>
          </div>
          <div>
            <div className="font-semibold text-sm">A sales entry feeds everything</div>
            <div className="text-[12px] text-slate-600 mt-1">
              When a sale is logged, the system updates Stock (drum out), Contract balance, Labour cost, and posts to Busy — all without manual entry. Busy sales also pull in here automatically.
            </div>
          </div>
        </div>
      </div>

      {/* Contracts table — green-soft */}
      <div className="card p-6" style={{ background: 'var(--green-soft)', border: '1px solid #bbf7d0' }}>
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div>
            <div className="text-base font-bold">Sales contracts</div>
            <div className="text-xs text-slate-500">Locked-in price · density spread auto-applied at dispatch · click a row to expand</div>
          </div>
          <button
            className="btn-accent pill px-4 py-2 font-semibold text-sm"
            onClick={() => setShowModal(true)}
          >
            + New contract
          </button>
        </div>
        <div className="overflow-x-auto scroll-x">
          <table className="dt">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Density</th>
                <th className="num">Locked ₹</th>
                <th className="num">Booked</th>
                <th className="num">Dispatched</th>
                <th className="num">Pending</th>
                <th>Progress</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {CONTRACTS.map(c => {
                const pct = Math.round(c.dispatched / c.booked * 100);
                const sc = c.status === 'on track' ? '#16A34A' : c.status === 'closed' ? '#475569' : '#DC2626';
                const sb = c.status === 'on track' ? '#DCFCE7' : c.status === 'closed' ? '#F1F5F9' : '#FEE2E2';
                const pending = c.booked - c.dispatched;
                const isSelected = selectedContract?.cust === c.cust;
                return (
                  <React.Fragment key={c.cust}>
                    <tr
                      style={{ cursor: 'pointer' }}
                      className={isSelected ? 'bg-orange-50' : ''}
                      onClick={() => setSelectedContract(isSelected ? null : c)}
                    >
                      <td className="font-semibold">{c.cust}</td>
                      <td><span className="density-pill">{c.d}</span></td>
                      <td className="num">₹ {c.lock}</td>
                      <td className="num">{c.booked}</td>
                      <td className="num">{c.dispatched}</td>
                      <td className="num font-semibold" style={{ color: pending > 0 ? '#F47651' : '#475569' }}>
                        {pending}
                      </td>
                      <td>
                        <div className="progress" style={{ width: '80px' }}>
                          <div style={{ width: `${pct}%` }}></div>
                        </div>
                      </td>
                      <td>
                        <span className="badge" style={{ background: sb, color: sc }}>
                          {c.status.toUpperCase()}
                        </span>
                      </td>
                    </tr>
                    {isSelected && (
                      <tr>
                        <td colSpan={8} style={{ padding: 0 }}>
                          <div className="px-4 py-4 bg-orange-50 border-t border-orange-100 flex flex-wrap gap-6">
                            <div>
                              <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Contract progress</div>
                              <div className="text-2xl font-extrabold num">{pct}%</div>
                              <div className="text-xs text-slate-500">{c.dispatched} of {c.booked} drums dispatched</div>
                            </div>
                            <div>
                              <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Pending dispatch</div>
                              <div className="text-2xl font-extrabold num" style={{ color: pending > 0 ? '#F47651' : '#16A34A' }}>
                                {pending} drums
                              </div>
                              <div className="text-xs text-slate-500">@ ₹{c.lock}/drum locked</div>
                            </div>
                            <div>
                              <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Pending value</div>
                              <div className="text-2xl font-extrabold num">₹ {(pending * c.lock).toLocaleString('en-IN')}</div>
                              <div className="text-xs text-slate-500">estimated</div>
                            </div>
                            <div className="flex items-end gap-2 ml-auto">
                              <button
                                className="btn-ghost pill px-3 py-2 text-xs font-semibold"
                                onClick={() => setSelectedContract(null)}
                              >
                                Close
                              </button>
                              <button className="btn-accent pill px-3 py-2 text-xs font-semibold">
                                Log dispatch
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── New Contract Modal ── */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(4px)' }}
          onClick={e => { if (e.target === e.currentTarget) handleCloseModal(); }}
        >
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-7 relative">
            {/* Header */}
            <div className="flex items-start justify-between mb-6">
              <div>
                <div className="text-[11px] text-slate-400 uppercase tracking-wider mb-1">Sales · Contracts</div>
                <div className="text-xl font-bold">New sales contract</div>
                <div className="text-xs text-slate-500 mt-1">Lock in price and booked quantity for a customer</div>
              </div>
              <button
                className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center shrink-0 ml-4 transition-colors"
                onClick={handleCloseModal}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M18 6 6 18M6 6l12 12"/>
                </svg>
              </button>
            </div>

            {formSaved ? (
              <div className="text-center py-8">
                <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-3">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#16A34A" strokeWidth="2.5">
                    <path d="M20 6 9 17l-5-5"/>
                  </svg>
                </div>
                <div className="font-semibold text-green-700">Contract saved</div>
                <div className="text-xs text-slate-500 mt-1">Syncing to Busy…</div>
              </div>
            ) : (
              <>
                {/* Form fields */}
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">Customer name *</label>
                    <input
                      type="text"
                      value={form.customer}
                      onChange={e => handleFormChange('customer', e.target.value)}
                      placeholder="e.g. Samarth Polymers"
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-200 focus:border-orange-300 transition"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">Density grade</label>
                    <div className="flex gap-2 flex-wrap">
                      {DENSITY_OPTIONS.map(d => (
                        <button
                          key={d}
                          onClick={() => handleFormChange('density', d)}
                          className={`px-4 py-2 rounded-xl text-sm font-semibold border transition-colors ${
                            form.density === d
                              ? 'bg-slate-900 text-white border-slate-900'
                              : 'bg-slate-50 text-slate-600 border-slate-200 hover:border-slate-300'
                          }`}
                        >
                          {d}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1.5">Locked price (₹/drum) *</label>
                      <input
                        type="number"
                        value={form.lockedPrice}
                        onChange={e => handleFormChange('lockedPrice', e.target.value)}
                        placeholder="e.g. 85"
                        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-200 focus:border-orange-300 transition"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1.5">Booked quantity (drums) *</label>
                      <input
                        type="number"
                        value={form.bookedQty}
                        onChange={e => handleFormChange('bookedQty', e.target.value)}
                        placeholder="e.g. 50"
                        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-200 focus:border-orange-300 transition"
                      />
                    </div>
                  </div>

                  {/* Estimated value preview */}
                  {form.lockedPrice && form.bookedQty && (
                    <div className="bg-orange-50 border border-orange-100 rounded-xl px-4 py-3">
                      <div className="text-[11px] text-orange-600 font-semibold uppercase tracking-wider">Contract value</div>
                      <div className="text-xl font-extrabold num mt-0.5">
                        ₹ {(Number(form.lockedPrice) * Number(form.bookedQty)).toLocaleString('en-IN')}
                      </div>
                      <div className="text-xs text-slate-500">{form.bookedQty} drums × ₹{form.lockedPrice} · density {form.density}</div>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex gap-3 mt-6">
                  <button
                    className="btn-ghost pill flex-1 py-3 font-semibold text-sm"
                    onClick={handleCloseModal}
                  >
                    Cancel
                  </button>
                  <button
                    className="btn-accent pill flex-1 py-3 font-semibold text-sm"
                    disabled={!form.customer.trim() || !form.lockedPrice || !form.bookedQty}
                    onClick={handleSaveContract}
                    style={{ opacity: (!form.customer.trim() || !form.lockedPrice || !form.bookedQty) ? 0.5 : 1 }}
                  >
                    Save contract
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
