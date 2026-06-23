import React, { useState, useEffect } from 'react';
import { supabase } from '../../../lib/supabase';
import { insertRows } from '../../../lib/db';
import { useMentionNotifier } from '../../../lib/mentions';
import { useBlacklistGuard } from '../../../lib/blacklist/guard';
import { SlidePanel, PanelField, PanelInput, PanelSelect, PanelTextarea, PanelRow, PanelDivider, OcrUpload, PanelFooter } from '../../../components/SlidePanel';
import { KpiInfoButton } from '../../../components/KpiInfoButton';
import { useToast } from '../../../components/ui/toast';
import { SkeletonRows, ErrorState } from '../../../components/ui/states';
import type { Database } from '../../../lib/database.types';

type ReqRow = Database['public']['Tables']['store_requisitions']['Row'] & { plants?: { name: string | null } | null };
type InvRow = Database['public']['Tables']['store_inventory']['Row'];

function invStatus(r: InvRow): { label: string; bg: string; color: string } {
  if (Number(r.quantity) <= 0) return { label: 'Out of stock', bg: '#FEE2E2', color: '#DC2626' };
  if (Number(r.quantity) <= Number(r.low_threshold ?? 2)) return { label: 'Low', bg: '#FEF3C7', color: '#D97706' };
  return { label: 'In stock', bg: '#DCFCE7', color: '#16A34A' };
}

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


function ArrowRight() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="2.4">
      <path d="M5 12h14M13 6l6 6-6 6"/>
    </svg>
  );
}

const FALLBACK_PLANTS = ['SHD', 'Rehla', 'Ganjam', 'HQ'];
const UNITS  = ['nos', 'kg', 'L', 'sets', 'MT', 'boxes'];

const URGENCY_MAP: Record<string, 'low' | 'medium' | 'high' | 'plant_stopper'> = {
  Normal: 'medium',
  Urgent: 'high',
};

const STATUS_STAGE: Record<string, { bg: string; color: string; label: string }> = {
  pending:    { bg: '#FEF3C7', color: '#D97706', label: 'UNIT HEAD' },
  approved:   { bg: '#DCFCE7', color: '#16A34A', label: 'APPROVED' },
  dispatched: { bg: '#DBEAFE', color: '#2563EB', label: 'DISPATCHED' },
  received:   { bg: '#DCFCE7', color: '#16A34A', label: 'RECEIVED' },
  rejected:   { bg: '#FEE2E2', color: '#DC2626', label: 'REJECTED' },
};

export function StoreRequisitions() {
  const toast = useToast();
  const notifyMentions = useMentionNotifier();
  const screenBlacklist = useBlacklistGuard();
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [items, setItems] = useState<ReqRow[]>([]);
  const [dbPlants, setDbPlants] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [form, setForm] = useState({ item: '', plant: 'SHD', qty: '', unit: 'nos', priority: 'Normal', notes: '' });
  // Store register (maintenance spare-parts inventory)
  const [inventory, setInventory] = useState<InvRow[]>([]);
  const [storeFilter, setStoreFilter] = useState<string[]>([]); // empty = all stores

  async function load() {
    try {
      const { data: plantsData } = await supabase.from('plants').select('id, name')
        .returns<{ id: string; name: string }[]>();
      if (plantsData && plantsData.length > 0) setDbPlants(plantsData);

      const { data, error } = await supabase
        .from('store_requisitions')
        .select('*, plants(name)')
        .order('created_at', { ascending: false })
        .returns<ReqRow[]>();
      if (error) throw error;
      setItems(data || []);

      const { data: inv } = await supabase.from('store_inventory').select('*')
        .order('store', { ascending: true }).order('part_name', { ascending: true }).returns<InvRow[]>();
      setInventory(inv || []);
      setLoadError(false);
    } catch (err) {
      console.error('[StoreRequisitions] load failed', err);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const plantNames = dbPlants.length > 0 ? dbPlants.map(p => p.name) : FALLBACK_PLANTS;

  // ── Store register (inventory) derived ────────────────────────────────────
  const stores = [...new Set(inventory.map(r => r.store))].sort();
  const shownInv = storeFilter.length ? inventory.filter(r => storeFilter.includes(r.store)) : inventory;
  function toggleStore(s: string) { setStoreFilter(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]); }

  function set(k: string, v: string) { setForm(f => ({ ...f, [k]: v })); }

  async function handleSave() {
    if (!form.item.trim() || !form.qty) return;
    const plant = dbPlants.find(p => p.name === form.plant);
    const { data, error } = await insertRows('store_requisitions', {
      item: form.item,
      plant_id: plant?.id || null,
      qty: parseFloat(form.qty) || 0,
      urgency: URGENCY_MAP[form.priority] || 'medium',
      status: 'pending',
      remarks: [form.unit ? `Unit: ${form.unit}` : '', form.notes].filter(Boolean).join(' · ') || null,
    }).select('*, plants(name)').single();

    if (error) {
      toast.error(`Save failed: ${error.message}`);
      return;
    }
    if (data) {
      setItems(prev => [data as ReqRow, ...prev]);
      // Notify admin and unit head
      insertRows('notifications', {
        target_roles: ['admin', 'unit_head'],
        title: `Store req raised: ${form.item}`,
        body: `${form.plant} · Qty: ${form.qty} ${form.unit} · ${form.priority}`,
        type: form.priority === 'Urgent' ? 'urgent' : 'info',
        route: '/dashboard/purchase/storereq',
        actor_name: form.plant,
        actor_role: 'warehouse_manager',
        read_by: [],
      }).then(() => {}, () => {});
      await notifyMentions(form.notes, {
        entityType: 'store_requisition', entityId: (data as ReqRow).id,
        entityLabel: `Store req · ${form.item}`, route: '/dashboard/purchase/storereq',
      });
    }
    const hits = await screenBlacklist(
      [{ value: form.item, label: 'Item' }, { value: form.notes, label: 'Notes' }],
      { workflow: 'Store Requisition', source: 'entry', entityLabel: `Store req · ${form.item}` },
    );
    if (hits.length) {
      const h = hits[0];
      toast.error(`⚠ "${h.candidate.value}" ≈ blacklisted ${h.entry.type} "${h.entry.name}" (${Math.round(h.score * 100)}%). Admin notified.`);
    }
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

      {/* ── Store register (maintenance spare-parts inventory) ──────────────── */}
      <div className="card p-6 mb-5">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
          <div>
            <div className="text-base font-bold">Store register · spare parts</div>
            <div className="text-xs text-slate-500">Live stock per store — fed by the maintenance flow · quantity drops when a part is issued</div>
          </div>
          <div className="flex items-center gap-3 text-[11px]">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><span style={{ width: 9, height: 9, borderRadius: '50%', background: '#16A34A', display: 'inline-block' }} /> In stock</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><span style={{ width: 9, height: 9, borderRadius: '50%', background: '#D97706', display: 'inline-block' }} /> Low</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><span style={{ width: 9, height: 9, borderRadius: '50%', background: '#DC2626', display: 'inline-block' }} /> Out</span>
          </div>
        </div>

        {/* Store filter — single / multi / all */}
        {stores.length > 0 && (
          <div className="flex gap-2 mb-4 flex-wrap">
            <button onClick={() => setStoreFilter([])} className={`chip${storeFilter.length === 0 ? ' active' : ''}`}>All stores</button>
            {stores.map(s => (
              <button key={s} onClick={() => toggleStore(s)} className={`chip${storeFilter.includes(s) ? ' active' : ''}`}>{s}</button>
            ))}
          </div>
        )}

        <div className="overflow-x-auto scroll-x">
          <table className="dt">
            <thead><tr><th>Part</th><th>Store</th><th className="num">Quantity</th><th>Status</th></tr></thead>
            <tbody>
              {shownInv.length === 0 && (
                <tr><td colSpan={4} className="text-center text-slate-400 py-6 text-sm">No parts in the register yet — it fills as store managers report stock in the maintenance flow.</td></tr>
              )}
              {shownInv.map(r => {
                const st = invStatus(r);
                return (
                  <tr key={r.id}>
                    <td className="font-semibold text-slate-700">{r.part_name}</td>
                    <td className="text-slate-500 text-xs">{r.store}</td>
                    <td className="num font-bold" style={{ color: st.color }}>{Number(r.quantity)}</td>
                    <td><span className="badge" style={{ background: st.bg, color: st.color, fontWeight: 700 }}>{st.label}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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
        {loadError ? (
          <ErrorState title="Couldn't load requisitions" message="The store requisition records failed to load."
            onRetry={() => { setLoading(true); setLoadError(false); load(); }} />
        ) : loading ? (
          <SkeletonRows rows={6} />
        ) : (
        <div className="overflow-x-auto scroll-x">
          <table className="dt">
            <thead>
              <tr>
                <th>Req #</th><th>Item</th><th>Plant</th><th className="num">Qty</th>
                <th>Stage</th><th>Awaiting</th><th>Decision</th><th>Pic</th>
              </tr>
            </thead>
            <tbody>
              {items.map(r => {
                const s = STATUS_STAGE[r.status] || STATUS_STAGE.pending;
                return (
                  <tr key={r.id} style={{ cursor: 'pointer' }}>
                    <td className="font-bold text-xs text-slate-400">{r.id.slice(0, 8)}</td>
                    <td>{r.item}</td>
                    <td>{r.plants?.name || '—'}</td>
                    <td className="num">{r.qty}</td>
                    <td>
                      <span className="badge" style={{ background: s.bg, color: s.color }}>{s.label}</span>
                    </td>
                    <td className="text-slate-500">{r.status === 'pending' ? 'Unit Head' : '—'}</td>
                    <td className="font-semibold">{r.status}</td>
                    <td><PicBadge has={!!r.photo_url} /></td>
                  </tr>
                );
              })}
              {items.length === 0 && (
                <tr><td colSpan={8} className="text-center text-slate-400 py-6 text-sm">No requisitions yet — raise the first one</td></tr>
              )}
            </tbody>
          </table>
        </div>
        )}
      </div>

      {/* Slide panel */}
      <SlidePanel open={open} onClose={handleClose} title="Raise store request" subtitle="Store Req · Purchase">
        <PanelField label="Item / material *">
          <PanelInput placeholder="e.g. PP Ball, NC Thinner, O-ring kit" value={form.item} onChange={e => set('item', e.target.value)} />
        </PanelField>

        <PanelRow>
          <PanelField label="Plant *">
            <PanelSelect value={form.plant} onChange={e => set('plant', e.target.value)}>
              {plantNames.map(p => <option key={p}>{p}</option>)}
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
