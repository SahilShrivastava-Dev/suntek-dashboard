import React, { useState, useEffect } from 'react';
import { supabase } from '../../../lib/supabase';
import { insertRows } from '../../../lib/db';
import { useMentionNotifier } from '../../../lib/mentions';
import { SlidePanel, PanelField, PanelInput, PanelSelect, PanelTextarea, PanelRow, PanelDivider, OcrUpload, PanelFooter } from '../../../components/SlidePanel';
import { KpiInfoButton } from '../../../components/KpiInfoButton';
import { useToast } from '../../../components/ui/toast';
import { SkeletonRows, ErrorState } from '../../../components/ui/states';
import type { Database } from '../../../lib/database.types';

type Panel = 'topup' | 'ledger' | null;
type LedgerRow = Database['public']['Tables']['marine_insurance']['Row'];

export function MarineInsurance() {
  const toast = useToast();
  const notifyMentions = useMentionNotifier();
  const [panel, setPanel] = useState<Panel>(null);
  const [saved, setSaved] = useState(false);
  const [ledgerFilter, setLedgerFilter] = useState<'all' | 'top-up' | 'deduct'>('all');
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const today = new Date().toISOString().split('T')[0];
  const [form, setForm] = useState({ amount: '', reference: '', date: today, mode: 'NEFT', notes: '' });

  async function load() {
    try {
      const { data, error } = await supabase
        .from('marine_insurance')
        .select('*')
        .order('date', { ascending: false })
        .returns<LedgerRow[]>();
      if (error) throw error;
      setLedger(data || []);
      setLoadError(false);
    } catch (err) {
      console.error('[MarineInsurance] load failed', err);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const currentBalance = ledger.length > 0 ? ledger[0].balance : 0;

  function set(k: string, v: string) { setForm(f => ({ ...f, [k]: v })); }

  async function handleSave() {
    if (!form.amount.trim()) return;
    const topUpAmt = parseFloat(form.amount) || 0;
    const newBal = currentBalance + topUpAmt;
    const { data, error } = await insertRows('marine_insurance', {
      date: form.date,
      type: 'top_up',
      reference: form.reference || null,
      amount: topUpAmt,
      balance: newBal,
    }).select('*').single();

    if (error) {
      toast.error(`Save failed: ${error.message}`);
      return;
    }
    if (data) setLedger(prev => [data as LedgerRow, ...prev]);
    await notifyMentions(form.notes, {
      entityType: 'marine_insurance', entityId: (data as LedgerRow | undefined)?.id,
      entityLabel: 'Marine insurance top-up', route: '/dashboard/purchase/marine',
    });
    setSaved(true);
    setTimeout(() => { setPanel(null); setSaved(false); setForm({ amount: '', reference: '', date: today, mode: 'NEFT', notes: '' }); }, 1600);
  }

  function handleClose() { setPanel(null); setSaved(false); }

  const newBalance = form.amount ? (currentBalance + parseFloat(form.amount || '0')).toFixed(2) : null;

  const ledgerList = ledger.filter(l =>
    ledgerFilter === 'all' ? true : ledgerFilter === 'top-up' ? l.type === 'top_up' : l.type === 'deduction'
  );

  return (
    <>
      {/* Balance + stats */}
      <div className="grid grid-cols-12 gap-5 mb-5">
        <div className="col-span-12 lg:col-span-6 card p-6" style={{ background: 'var(--red-soft)', border: '1px solid #fecaca', position: 'relative' }}>
          <KpiInfoButton info={{ title: 'Marine Insurance Balance', what: 'Running prepaid balance on the open marine insurance policy. Every supplier dispatch auto-deducts the insured value. Balance drops below ₹1 Cr triggers a top-up alert.', source: 'Form entry', formLabel: 'Top-up form', formPath: '/dashboard/purchase/marine', note: 'Top-ups logged manually via the "Top up" slide panel. Auto-deduction is applied per dispatch entry.' }} />
          <div className="flex items-start justify-between">
            <div>
              <div className="text-xs text-slate-500 mb-1">Marine insurance balance</div>
              <div className="text-3xl font-extrabold num">
                ₹ {currentBalance.toFixed(2)} Cr{' '}
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
            <button className="btn-accent pill px-4 py-2 font-semibold text-sm" onClick={() => setPanel('topup')}>
              Top up
            </button>
            <button className="btn-outline pill px-4 py-2 font-semibold text-sm" onClick={() => setPanel('ledger')}>
              View ledger
            </button>
          </div>
        </div>
        <div className="col-span-12 lg:col-span-3 card p-5" style={{ position: 'relative' }}>
          <KpiInfoButton info={{ title: 'Marine Insurance Top-ups FY', what: 'Number of times the marine insurance prepaid balance has been topped up during the current financial year. Frequent top-ups may indicate high dispatch volume or underestimated policy size.', source: 'Form entry', formLabel: 'Top-up form', formPath: '/dashboard/purchase/marine' }} />
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">Top-ups this FY</div>
          <div className="text-[28px] font-extrabold mt-1 num">2</div>
          <div className="text-[11px] text-slate-500 mt-1">last on 18 Mar</div>
        </div>
        <div className="col-span-12 lg:col-span-3 card p-5" style={{ position: 'relative' }}>
          <KpiInfoButton info={{ title: 'Avg Deduction per Dispatch', what: 'Average marine insurance amount deducted for each supplier dispatch this month. Calculated from total MTD deductions divided by dispatch count. Reflects average shipment insured value.', source: 'Form entry', formLabel: 'Dispatch log (auto-deduct)', formPath: '/dashboard/purchase/marine', note: 'Deductions come from MARINE_LEDGER entries with type "deduct".' }} />
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">Avg deduction / dispatch</div>
          <div className="text-[28px] font-extrabold mt-1 num">₹ 16 L</div>
          <div className="text-[11px] text-slate-500 mt-1">31 dispatches MTD</div>
        </div>
      </div>

      {/* Ledger table */}
      <div className="card p-6" style={{ position: 'relative' }}>
        <KpiInfoButton info={{ title: 'Marine Insurance Ledger', what: 'Transaction history of the marine insurance prepaid balance — all top-ups (credits) and dispatch deductions (debits). Running balance is shown per row. New top-ups entered via the "Top up" slide panel; deductions are auto-logged per supplier dispatch.', source: 'Form entry', formLabel: 'Top-up / View ledger panel', formPath: '/dashboard/purchase/marine', note: 'Data from MARINE_LEDGER mock (mockData.ts). Future: Supabase marine_ledger table.' }} />
        <div className="text-base font-bold mb-3">Recent ledger</div>
        {loadError ? (
          <ErrorState title="Couldn't load the ledger" message="The marine insurance ledger failed to load."
            onRetry={() => { setLoading(true); setLoadError(false); load(); }} />
        ) : loading ? (
          <SkeletonRows rows={6} />
        ) : (
        <div className="overflow-x-auto scroll-x">
          <table className="dt">
            <thead>
              <tr>
                <th>Date</th><th>Type</th><th>Reference</th>
                <th className="num">Amount</th><th className="num">Balance</th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((l, i) => (
                <tr key={l.id || i}>
                  <td className="text-slate-500">{l.date}</td>
                  <td>
                    {l.type === 'top_up'
                      ? <span className="badge" style={{ background: '#DCFCE7', color: '#16A34A' }}>TOP-UP</span>
                      : <span className="badge" style={{ background: '#FEE2E2', color: '#DC2626' }}>DEDUCT</span>
                    }
                  </td>
                  <td>{l.reference || '—'}</td>
                  <td className="num font-semibold" style={{ color: l.amount > 0 ? '#16A34A' : '#DC2626' }}>
                    {l.amount > 0 ? '+' : ''}₹ {Math.abs(l.amount)} Cr
                  </td>
                  <td className="num">₹ {l.balance} Cr</td>
                </tr>
              ))}
              {ledger.length === 0 && (
                <tr><td colSpan={5} className="text-center text-slate-400 py-6 text-sm">No ledger entries yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
        )}
      </div>

      {/* Top-up panel */}
      <SlidePanel open={panel === 'topup'} onClose={handleClose} title="Top up marine insurance" subtitle="Marine Insurance · Purchase">
        <PanelField label="Top-up amount (₹ Cr) *">
          <PanelInput type="number" step="0.01" placeholder="e.g. 0.50" value={form.amount} onChange={e => set('amount', e.target.value)} />
        </PanelField>

        {newBalance && (
          <div style={{ margin: '-8px 0 16px', padding: '10px 14px', background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 12, fontSize: 13 }}>
            New balance after top-up: <strong>₹ {newBalance} Cr</strong>
          </div>
        )}

        <PanelRow>
          <PanelField label="Reference / policy no">
            <PanelInput placeholder="e.g. POL-2026-4421" value={form.reference} onChange={e => set('reference', e.target.value)} />
          </PanelField>
          <PanelField label="Payment mode">
            <PanelSelect value={form.mode} onChange={e => set('mode', e.target.value)}>
              <option>NEFT</option>
              <option>RTGS</option>
              <option>Cheque</option>
              <option>DD</option>
            </PanelSelect>
          </PanelField>
        </PanelRow>

        <PanelField label="Date">
          <PanelInput type="date" value={form.date} onChange={e => set('date', e.target.value)} />
        </PanelField>

        <PanelField label="Notes">
          <PanelTextarea placeholder="Any remarks about this top-up…" value={form.notes} onChange={e => set('notes', e.target.value)} />
        </PanelField>

        <PanelDivider />

        <OcrUpload
          label="Payment receipt / policy document"
          hint="Upload bank receipt — AI reads amount, reference and date"
          fields={[
            { key: 'amount',    label: 'Amount (₹)',   value: '1,50,000' },
            { key: 'reference', label: 'UTR / Ref No', value: 'NEFT2026060900123' },
            { key: 'mode',      label: 'Mode',         value: 'NEFT' },
          ]}
          onExtracted={data => {
            if (data.amount)    set('amount',    data.amount);
            if (data.reference) set('reference', data.reference);
            if (data.mode)      set('mode',      data.mode);
          }}
        />

        <PanelFooter
          saved={saved}
          onCancel={handleClose}
          onSave={handleSave}
          saveLabel="Record top-up"
          successLabel="Top-up recorded"
          successSub="Balance updated · ledger entry created"
          disabled={!form.amount.trim()}
          requiredHint="Enter the top-up amount to continue"
        />
      </SlidePanel>

      {/* Ledger view panel */}
      <SlidePanel open={panel === 'ledger'} onClose={handleClose} title="Full ledger" subtitle="Marine Insurance · All entries">
        {/* Filter tabs */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
          {(['all', 'top-up', 'deduct'] as const).map(f => (
            <button
              key={f}
              onClick={() => setLedgerFilter(f === 'top-up' ? 'top-up' : f === 'deduct' ? 'deduct' : 'all')}
              style={{
                padding: '6px 16px', borderRadius: 20, fontSize: 12, fontWeight: 600,
                border: '1px solid',
                borderColor: ledgerFilter === f ? '#F47651' : '#E2E8F0',
                background: ledgerFilter === f ? '#FFF0EB' : '#F8FAFC',
                color: ledgerFilter === f ? '#F47651' : '#475569',
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              {f === 'all' ? 'All' : f === 'top-up' ? 'Top-ups' : 'Deductions'}
            </button>
          ))}
          <span style={{ marginLeft: 'auto', fontSize: 12, color: '#94A3B8', alignSelf: 'center' }}>
            {ledgerList.length} entries
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {ledgerList.map((l, i) => (
            <div key={l.id || i} style={{ padding: '12px 14px', borderRadius: 12, border: '1px solid #F1F5F9', background: '#FAFAFA', display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{
                width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                background: l.type === 'top_up' ? '#16A34A' : '#DC2626',
              }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#0F172A' }}>{l.reference || '—'}</div>
                <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }}>{l.date}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: l.amount > 0 ? '#16A34A' : '#DC2626' }}>
                  {l.amount > 0 ? '+' : ''}₹ {Math.abs(l.amount)} Cr
                </div>
                <div style={{ fontSize: 11, color: '#94A3B8' }}>Bal ₹ {l.balance} Cr</div>
              </div>
            </div>
          ))}
          {ledgerList.length === 0 && (
            <div style={{ textAlign: 'center', color: '#94A3B8', padding: '24px 0', fontSize: 13 }}>No entries</div>
          )}
        </div>
      </SlidePanel>
    </>
  );
}
