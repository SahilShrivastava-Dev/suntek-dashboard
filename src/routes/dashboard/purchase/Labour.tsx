import React, { useState, useEffect } from 'react';
import { supabase } from '../../../lib/supabase';
import { SlidePanel, PanelField, PanelInput, PanelTextarea, PanelDivider, PanelFooter } from '../../../components/SlidePanel';
import { SkeletonRows, ErrorState } from '../../../components/ui/states';
import { useMentionNotifier } from '../../../lib/mentions';
import type { Database } from '../../../lib/database.types';

type LabourRow = Database['public']['Tables']['labour_costs']['Row'] & { plants?: { name: string | null } | null };

export function Labour() {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [costs, setCosts] = useState<LabourRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [form, setForm] = useState({ baseRate: '1487', targetRate: '1450', overhead: '12', transport: '85', reason: '' });
  const notifyMentions = useMentionNotifier();

  async function load() {
    try {
      const { data, error } = await supabase
        .from('labour_costs')
        .select('*, plants(name)')
        .order('date', { ascending: false })
        .returns<LabourRow[]>();
      if (error) throw error;
      setCosts(data || []);
      setLoadError(false);
    } catch (err) {
      console.error('[Labour] load failed', err);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function set(k: string, v: string) { setForm(f => ({ ...f, [k]: v })); }

  async function handleSave() {
    await notifyMentions(form.reason, { entityLabel: 'Labour rate update', route: '/dashboard/purchase/labour' });
    setSaved(true);
    setTimeout(() => { setOpen(false); setSaved(false); }, 1600);
  }

  function handleClose() { setOpen(false); setSaved(false); }

  const totalCost = costs.reduce((s, c) => s + (c.computed_cost || 0), 0);
  const flaggedCount = costs.filter(c => c.is_flagged).length;

  return (
    <>
      {/* KPI row */}
      <div className="grid grid-cols-12 gap-5 mb-5">
        <div className="col-span-12 lg:col-span-3 card p-5">
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">Total labour cost</div>
          <div className="text-[28px] font-extrabold mt-1 num">
            {totalCost > 0 ? `₹ ${totalCost.toLocaleString('en-IN')}` : '—'}
          </div>
        </div>
        <div className="col-span-12 lg:col-span-3 card p-5">
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">Records</div>
          <div className="text-[28px] font-extrabold mt-1 num">{costs.length}</div>
          <div className="text-[11px] text-slate-500 mt-1">log entries</div>
        </div>
        <div className="col-span-12 lg:col-span-3 card p-5">
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">Avg per-MT cost</div>
          <div className="text-[28px] font-extrabold mt-1 num">
            {costs.length > 0
              ? `₹ ${Math.round(costs.reduce((s, c) => s + (c.per_mt_cost || 0), 0) / costs.length).toLocaleString('en-IN')}`
              : '—'}
          </div>
        </div>
        <div className="col-span-12 lg:col-span-3 card p-5">
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">Variance flagged</div>
          <div className={`text-[28px] font-extrabold mt-1 num ${flaggedCount > 0 ? 'text-amber-600' : ''}`}>
            {flaggedCount} plant{flaggedCount !== 1 ? 's' : ''}
          </div>
        </div>
      </div>

      {/* Per-plant table — green-soft */}
      <div className="card p-6 mb-5" style={{ background: 'var(--green-soft)', border: '1px solid #bbf7d0' }}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-base font-bold">Labour cost log</div>
            <div className="text-xs text-slate-500">
              Auto-derived from purchase qty × sales qty (sales feeds it automatically)
            </div>
          </div>
          <button className="btn-outline pill px-3 py-2 text-xs font-semibold" onClick={() => setOpen(true)}>
            Edit formula
          </button>
        </div>
        {loadError ? (
          <ErrorState title="Couldn't load labour costs" message="The labour cost records failed to load."
            onRetry={() => { setLoading(true); setLoadError(false); load(); }} />
        ) : loading ? (
          <SkeletonRows rows={5} />
        ) : (
        <div className="overflow-x-auto scroll-x">
          <table className="dt">
            <thead>
              <tr>
                <th>Plant</th>
                <th>Date</th>
                <th className="num">Purchase qty</th>
                <th className="num">Sales qty</th>
                <th className="num">Computed cost</th>
                <th className="num">Target cost</th>
                <th className="num">Per MT</th>
                <th>Variance</th>
                <th>Flag</th>
              </tr>
            </thead>
            <tbody>
              {costs.map(c => {
                const vPct = c.variance_pct || 0;
                const tColor = vPct > 0 ? '#D97706' : vPct < 0 ? '#16A34A' : '#475569';
                const tBg    = vPct > 0 ? '#FEF3C7' : vPct < 0 ? '#DCFCE7' : '#F1F5F9';
                const tLbl   = vPct > 0 ? `+${vPct.toFixed(1)}% over` : vPct < 0 ? `${Math.abs(vPct).toFixed(1)}% under` : 'on target';
                return (
                  <tr key={c.id} style={{ cursor: 'pointer' }}>
                    <td className="font-semibold">{c.plants?.name || '—'}</td>
                    <td className="text-slate-500 text-xs">{c.date}</td>
                    <td className="num text-slate-500">{c.purchased_qty ?? '—'}</td>
                    <td className="num text-slate-500">{c.sales_qty ?? '—'}</td>
                    <td className="num font-bold">₹ {(c.computed_cost || 0).toLocaleString('en-IN')}</td>
                    <td className="num text-slate-500">₹ {(c.target_cost || 0).toLocaleString('en-IN')}</td>
                    <td className="num">₹ {(c.per_mt_cost || 0).toLocaleString('en-IN')}</td>
                    <td>
                      <span className="badge" style={{ background: tBg, color: tColor }}>{tLbl}</span>
                    </td>
                    <td>{c.is_flagged ? <span className="badge" style={{ background: '#FEE2E2', color: '#DC2626' }}>FLAG</span> : '—'}</td>
                  </tr>
                );
              })}
              {costs.length === 0 && (
                <tr><td colSpan={9} className="text-center text-slate-400 py-6 text-sm">No labour cost records yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
        )}
      </div>

      {/* Slide panel */}
      <SlidePanel open={open} onClose={handleClose} title="Edit labour cost formula" subtitle="Labour · Purchase">
        <div style={{ padding: '12px 14px', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 12, marginBottom: 20, fontSize: 12, color: '#475569', lineHeight: 1.6 }}>
          <strong>Current formula:</strong><br />
          Cost = (Purchase qty − Sales qty) × Base rate per MT + (Overhead % × Base cost) + Transport allowance
        </div>

        <PanelField label="Base rate per MT (₹)">
          <PanelInput type="number" value={form.baseRate} onChange={e => set('baseRate', e.target.value)} />
        </PanelField>

        <PanelField label="Target per MT (₹)">
          <PanelInput type="number" value={form.targetRate} onChange={e => set('targetRate', e.target.value)} />
        </PanelField>

        <PanelField label="Overhead multiplier (%)">
          <PanelInput type="number" value={form.overhead} onChange={e => set('overhead', e.target.value)} />
        </PanelField>

        <PanelField label="Transport allowance (₹ / MT)">
          <PanelInput type="number" value={form.transport} onChange={e => set('transport', e.target.value)} />
        </PanelField>

        <PanelDivider />

        {form.baseRate && form.targetRate && (
          <div style={{ padding: '12px 14px', background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 12, marginBottom: 20, fontSize: 13 }}>
            Preview: ₹ {parseInt(form.baseRate).toLocaleString('en-IN')} / MT · target ₹ {parseInt(form.targetRate).toLocaleString('en-IN')} · variance {Math.abs(parseInt(form.baseRate) - parseInt(form.targetRate))} ₹/MT
          </div>
        )}

        <PanelField label="Reason for change">
          <PanelTextarea placeholder="Why are these rates being updated? e.g. fuel cost revision, revised contractor agreement…" value={form.reason} onChange={e => set('reason', e.target.value)} />
        </PanelField>

        <PanelFooter
          saved={saved}
          onCancel={handleClose}
          onSave={handleSave}
          saveLabel="Save formula"
          successLabel="Formula updated"
          successSub="Per-plant costs will recompute from next entry"
        />
      </SlidePanel>
    </>
  );
}
