import React, { useState } from 'react';
import { STORE_REQ } from '../../../data/mockData';
import { SlidePanel, PanelField, PanelInput, PanelSelect, PanelTextarea, PanelRow, PanelDivider, OcrUpload, PanelFooter } from '../../../components/SlidePanel';
import { KpiInfoButton } from '../../../components/KpiInfoButton';

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

const STAGE_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  'unit-head':     { bg: '#FEF3C7', color: '#D97706', label: 'UNIT HEAD' },
  'authorisation': { bg: '#FFEDE5', color: '#C5421F', label: 'AUTH BY VIJAY JI' },
  'in-stock':      { bg: '#DCFCE7', color: '#16A34A', label: 'IN STOCK' },
  'purchase':      { bg: '#DBEAFE', color: '#2563EB', label: 'PURCHASE' },
};

function ArrowRight() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="2.4">
      <path d="M5 12h14M13 6l6 6-6 6"/>
    </svg>
  );
}

const PLANTS = ['SHD', 'Rehla', 'Ganjam', 'HQ'];
const UNITS  = ['nos', 'kg', 'L', 'sets', 'MT', 'boxes'];

export function StoreRequisitions() {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState({ item: '', plant: 'SHD', qty: '', unit: 'nos', priority: 'Normal', notes: '' });

  function set(k: string, v: string) { setForm(f => ({ ...f, [k]: v })); }

  function handleSave() {
    if (!form.item.trim() || !form.qty) return;
    setSaved(true);
    setTimeout(() => { setOpen(false); setSaved(false); setForm({ item: '', plant: 'SHD', qty: '', unit: 'nos', priority: 'Normal', notes: '' }); }, 1600);
  }

  function handleClose() { setOpen(false); setSaved(false); }

  return (
    <>
      {/* Approval flow */}
      <div className="card p-6 mb-5" style={{ position: 'relative' }}>
        <KpiInfoButton info={{ title: 'Store Req Approval Flow', what: 'The 4-stage sign-off chain for any store/material requisition. Stage 4 (purchase approval by Vijay Ji) only triggers when the item is not in stock. This is a manual process tracked in this dashboard.', source: 'Form entry', formLabel: 'Raise request form', formPath: '/dashboard/purchase/storereq', note: 'Dummy flow diagram — actual stage tracking is in the STORE_REQ list below.' }} />
        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-3">Approval flow</div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="tile flex-1 min-w-[160px]">
            <div className="text-[11px] text-slate-500">1 · Raised by</div>
            <div className="font-semibold text-sm mt-1">Plant / store keeper</div>
          </div>
          <ArrowRight />
          <div className="tile flex-1 min-w-[160px]">
            <div className="text-[11px] text-slate-500">2 · Approved by</div>
            <div className="font-semibold text-sm mt-1">Unit head</div>
          </div>
          <ArrowRight />
          <div className="tile flex-1 min-w-[160px]">
            <div className="text-[11px] text-slate-500">3 · Stock check</div>
            <div className="font-semibold text-sm mt-1">In stock → supply</div>
          </div>
          <ArrowRight />
          <div className="tile flex-1 min-w-[160px]">
            <div className="text-[11px] text-slate-500">4 · Otherwise</div>
            <div className="font-semibold text-sm mt-1">Vijay Ji approves purchase</div>
          </div>
        </div>
      </div>

      {/* Table — green-soft */}
      <div className="card p-6" style={{ background: 'var(--green-soft)', border: '1px solid #bbf7d0', position: 'relative' }}>
        <KpiInfoButton info={{ title: 'Open Store Requirements', what: 'All active store requisitions raised by plant/store keepers across SHD, Rehla, Ganjam, and HQ. Each row shows the approval stage, decision, and photo proof status. New requests are submitted via the "+ Raise request" button.', source: 'Mock data', formLabel: 'Raise request form', formPath: '/dashboard/purchase/storereq', note: 'Currently uses STORE_REQ mock data. Future: Supabase store_reqs table.' }} />
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div>
            <div className="text-base font-bold">Open store requirements</div>
            <div className="text-xs text-slate-500">Pic proof of need attached</div>
          </div>
          <button className="btn-accent pill px-4 py-2 font-semibold text-sm" onClick={() => setOpen(true)}>
            + Raise request
          </button>
        </div>
        <div className="overflow-x-auto scroll-x">
          <table className="dt">
            <thead>
              <tr>
                <th>Req #</th><th>Item</th><th>Plant</th><th className="num">Qty</th>
                <th>Stage</th><th>Awaiting</th><th>Decision</th><th>Pic</th>
              </tr>
            </thead>
            <tbody>
              {STORE_REQ.map(r => {
                const s = STAGE_STYLE[r.stage] || STAGE_STYLE['unit-head'];
                return (
                  <tr key={r.id} style={{ cursor: 'pointer' }}>
                    <td className="font-bold">{r.id}</td>
                    <td>{r.item}</td>
                    <td>{r.plant}</td>
                    <td className="num">{r.qty}</td>
                    <td>
                      <span className="badge" style={{ background: s.bg, color: s.color }}>{s.label}</span>
                    </td>
                    <td className="text-slate-500">{r.wait}</td>
                    <td className="font-semibold">{r.decision}</td>
                    <td><PicBadge has={r.pic} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Slide panel */}
      <SlidePanel open={open} onClose={handleClose} title="Raise store request" subtitle="Store Req · Purchase">
        <PanelField label="Item / material *">
          <PanelInput placeholder="e.g. PP Ball, NC Thinner, O-ring kit" value={form.item} onChange={e => set('item', e.target.value)} />
        </PanelField>

        <PanelRow>
          <PanelField label="Plant *">
            <PanelSelect value={form.plant} onChange={e => set('plant', e.target.value)}>
              {PLANTS.map(p => <option key={p}>{p}</option>)}
            </PanelSelect>
          </PanelField>
          <PanelField label="Priority">
            <PanelSelect value={form.priority} onChange={e => set('priority', e.target.value)}>
              <option>Normal</option>
              <option>Urgent</option>
            </PanelSelect>
          </PanelField>
        </PanelRow>

        <PanelRow>
          <PanelField label="Quantity *">
            <PanelInput type="number" placeholder="e.g. 48" value={form.qty} onChange={e => set('qty', e.target.value)} />
          </PanelField>
          <PanelField label="Unit">
            <PanelSelect value={form.unit} onChange={e => set('unit', e.target.value)}>
              {UNITS.map(u => <option key={u}>{u}</option>)}
            </PanelSelect>
          </PanelField>
        </PanelRow>

        <PanelField label="Reason / notes">
          <PanelTextarea placeholder="Why is this item needed? Any urgency context…" value={form.notes} onChange={e => set('notes', e.target.value)} />
        </PanelField>

        <PanelDivider />

        <OcrUpload
          label="Pic proof of need"
          hint="Photo of broken part, empty shelf — AI reads item and quantity"
          fields={[
            { key: 'item',  label: 'Item identified', value: 'Mechanical seal — pump P-104' },
            { key: 'qty',   label: 'Est. quantity',   value: '2' },
            { key: 'notes', label: 'Condition note',  value: 'Worn seal causing leakage at flange joint' },
          ]}
          onExtracted={data => {
            if (data.item)  set('item',  data.item);
            if (data.qty)   set('qty',   data.qty);
            if (data.notes) set('notes', data.notes);
          }}
        />

        <div style={{ fontSize: 11, color: '#94A3B8', marginBottom: 16 }}>
          Auto-assigned Req # · enters approval queue at Unit Head stage
        </div>

        <PanelFooter
          saved={saved}
          onCancel={handleClose}
          onSave={handleSave}
          saveLabel="Submit request"
          successLabel="Request raised"
          successSub="Entering Unit Head approval queue"
          disabled={!form.item.trim() || !form.qty}
          requiredHint="Fill in Item and Quantity to submit"
        />
      </SlidePanel>
    </>
  );
}
