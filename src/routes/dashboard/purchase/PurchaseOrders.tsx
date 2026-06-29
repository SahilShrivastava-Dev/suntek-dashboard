import React, { useState, useEffect } from 'react';
import { supabase } from '../../../lib/supabase';
import { insertRows } from '../../../lib/db';
import { useMentionNotifier } from '../../../lib/mentions';
import { useBlacklistGuard } from '../../../lib/blacklist/guard';
import { exportToXlsx } from '../../../lib/utils/exportXlsx';
import { useRoleContext } from '../../../contexts/RoleContext';
import { SlidePanel, PanelField, PanelInput, PanelSelect, PanelTextarea, PanelRow, PanelDivider, PanelSection, OcrUpload, PanelFooter } from '../../../components/SlidePanel';
import { KpiInfoButton } from '../../../components/KpiInfoButton';
import { useToast } from '../../../components/ui/toast';
import { SkeletonRows, ErrorState } from '../../../components/ui/states';
import { OcrUploadCard } from '../../../components/OcrUploadCard';
import type { Database } from '../../../lib/database.types';

// Purchase sheet OCR upload is available to management/finance roles only.
const CAN_UPLOAD_SHEET = ['admin', 'unit_head', 'accountant_delhi', 'accountant_other'];

type OrderRow = Database['public']['Tables']['oil_contracts']['Row'];
type MaintStoreReq = Database['public']['Tables']['maintenance_store_requests']['Row'];
type MaintTicket = Database['public']['Tables']['maintenance_tickets']['Row'] & { plants?: { name: string | null } | null };

const UNIT_LABELS: Record<string, string> = { chlorides: 'Suntek Chlorides', plasticiser: 'Suntek Plasticiser' };

/** An externally-bought maintenance part, DERIVED from a store request (single source). */
interface MaintPO {
  id: string; ticketRef: string; part: string; equipment: string; store: string; supplier: string;
  qty: number; unitPrice: number | null; total: number | null; date: string | null; busyRef: string | null;
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

const STATUS_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  approved:   { bg: '#FEF3C7', color: '#D97706', label: 'APPROVED'   },
  dispatched: { bg: '#DCFCE7', color: '#16A34A', label: 'DISPATCHED' },
  received:   { bg: '#DBEAFE', color: '#2563EB', label: 'RECEIVED'   },
  pending:    { bg: '#F1F5F9', color: '#475569', label: 'PENDING'    },
};

const PLANTS = ['SHD', 'Rehla', 'Ganjam', 'HQ'];
const UNITS  = ['nos', 'kg', 'MT', 'L', 'sets', 'boxes'];

export function PurchaseOrders() {
  const toast = useToast();
  const notifyMentions = useMentionNotifier();
  const screenBlacklist = useBlacklistGuard();
  const [filter, setFilter] = useState('all');
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [maintPOs, setMaintPOs] = useState<MaintPO[]>([]); // derived from the maintenance flow
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const { activeProfile } = useRoleContext();
  const [form, setForm] = useState({ material: '', type: 'PO', supplier: '', destination: 'SHD', qty: '', unit: 'nos', value: '', notes: '' });

  async function load() {
    try {
      const { data, error } = await supabase
        .from('oil_contracts')
        .select('*')
        .order('created_at', { ascending: false })
        .returns<OrderRow[]>();
      if (error) throw error;
      setOrders(data || []);

      // Derive externally-bought maintenance parts (store said "not available")
      // straight from the maintenance flow — single source, always in sync.
      const { data: tickets } = await supabase.from('maintenance_tickets')
        .select('*, plants(name)').eq('type', 'emergency').returns<MaintTicket[]>();
      const tIds = (tickets || []).map(t => t.id);
      let srs: MaintStoreReq[] = [];
      if (tIds.length) {
        const { data: srData } = await supabase.from('maintenance_store_requests').select('*').in('ticket_id', tIds).returns<MaintStoreReq[]>();
        srs = srData || [];
      }
      const tById = new Map((tickets || []).map(t => [t.id, t]));
      const mpos: MaintPO[] = srs
        .filter(s => s.store_decision === 'unavailable' && (s.busy_transaction_ref || s.supplier_name || s.total_price != null))
        .map(s => {
          const t = tById.get(s.ticket_id);
          const store = t?.unit ? (UNIT_LABELS[t.unit] || t.unit) : (t?.plants?.name || '—');
          return {
            id: s.id, ticketRef: s.ticket_id.slice(0, 8), part: s.part_name, equipment: t?.equipment || '', store,
            supplier: s.supplier_name || '—', qty: Number(s.quantity ?? 0),
            unitPrice: s.unit_price != null ? Number(s.unit_price) : null,
            total: s.total_price != null ? Number(s.total_price) : null,
            date: t?.closed_at || t?.created_at || null, busyRef: s.busy_transaction_ref,
          };
        });
      setMaintPOs(mpos);
      setLoadError(false);
    } catch (err) {
      console.error('[PurchaseOrders] load failed', err);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function set(k: string, v: string) { setForm(f => ({ ...f, [k]: v })); }

  async function handleSave() {
    if (!form.material.trim() || !form.supplier.trim()) return;
    const { data, error } = await insertRows('oil_contracts', {
      oil_type: form.material,
      company: form.supplier,
      date: new Date().toISOString().split('T')[0],
      book_qty_mt: parseFloat(form.qty) || null,
      price: form.value ? parseFloat(form.value.replace(/[^0-9.]/g, '')) : null,
      port: form.destination,
    }).select('*').single();

    if (error) { toast.error(`Save failed: ${error.message}`); return; }
    if (data) setOrders(prev => [data as OrderRow, ...prev]);
    await notifyMentions(form.notes, {
      entityType: 'oil_contract', entityId: (data as OrderRow | undefined)?.id,
      entityLabel: `PO · ${form.material || form.supplier}`, route: '/dashboard/purchase/purchase',
    });
    // Screen the supplier/material against the blacklist (vendor risk).
    const hits = await screenBlacklist(
      [{ value: form.supplier, label: 'Supplier' }, { value: form.material, label: 'Material' }],
      { workflow: 'Purchase Orders', source: 'entry', entityLabel: `PO · ${form.material || form.supplier}` },
    );
    if (hits.length) {
      const h = hits[0];
      toast.error(`⚠ "${h.candidate.value}" ≈ blacklisted ${h.entry.type} "${h.entry.name}" (${Math.round(h.score * 100)}%). Admin notified.`);
    }
    setSaved(true);
    setTimeout(() => { setOpen(false); setSaved(false); setForm({ material: '', type: 'PO', supplier: '', destination: 'SHD', qty: '', unit: 'nos', value: '', notes: '' }); }, 1600);
  }

  function handleClose() { setOpen(false); setSaved(false); }

  function handleExport() {
    const rows = (filter === 'all' ? orders : orders.filter(r => r.status === filter));
    exportToXlsx(
      rows.map(r => ({ material: r.oil_type, supplier: r.company, destination: r.port, quantity: r.book_qty_mt, dispatched: r.dispatched_qty, pending: r.pending_qty, price: r.price })),
      [
        { header: 'Material / Oil Type', key: 'material' },
        { header: 'Supplier', key: 'supplier' },
        { header: 'Port / Destination', key: 'destination' },
        { header: 'Booked Qty (MT)', key: 'quantity' },
        { header: 'Dispatched (MT)', key: 'dispatched' },
        { header: 'Pending (MT)', key: 'pending' },
        { header: 'Price (₹)', key: 'price' },
      ],
      'purchase-orders',
      activeProfile,
      'Purchase Orders',
    );
  }

  const list = filter === 'all' ? orders : orders.filter(r => r.status === filter);

  return (
    <>
      {/* Purchase sheet OCR upload — management/finance only */}
      {CAN_UPLOAD_SHEET.includes(activeProfile.id) && <OcrUploadCard kind="purchase" />}

      {/* KPI row */}
      <div className="grid grid-cols-12 gap-5 mb-5">
        <div className="col-span-12 lg:col-span-3 card p-5" style={{ position: 'relative' }}>
          <KpiInfoButton info={{ title: 'Total Orders', what: 'Total count of oil/material purchase contracts on record.', source: 'Supabase', tables: ['oil_contracts'] }} />
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">Total orders</div>
          <div className="text-[28px] font-extrabold mt-1 num">{orders.length + maintPOs.length}</div>
          <div className="text-[11px] text-slate-500 mt-1">{orders.length} material/oil · {maintPOs.length} maintenance</div>
        </div>
        <div className="col-span-12 lg:col-span-3 card p-5" style={{ position: 'relative' }}>
          <KpiInfoButton info={{ title: 'Total Booked Qty', what: 'Sum of all booked quantities (MT) across all purchase orders.', source: 'Supabase', tables: ['oil_contracts'] }} />
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">Booked qty (MT)</div>
          <div className="text-[28px] font-extrabold mt-1 num">
            {orders.reduce((s, r) => s + (r.book_qty_mt || 0), 0).toFixed(0)}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">across all POs</div>
        </div>
        <div className="col-span-12 lg:col-span-3 card p-5" style={{ position: 'relative' }}>
          <KpiInfoButton info={{ title: 'Dispatched', what: 'Total quantity already dispatched from suppliers.', source: 'Supabase', tables: ['oil_contracts'] }} />
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">Dispatched (MT)</div>
          <div className="text-[28px] font-extrabold mt-1 num text-green-600">
            {orders.reduce((s, r) => s + (r.dispatched_qty || 0), 0).toFixed(0)}
          </div>
        </div>
        <div className="col-span-12 lg:col-span-3 card p-5" style={{ position: 'relative' }}>
          <KpiInfoButton info={{ title: 'Pending Qty', what: 'Total quantity still pending dispatch from suppliers.', source: 'Supabase', tables: ['oil_contracts'] }} />
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">Pending (MT)</div>
          <div className="text-[28px] font-extrabold mt-1 num text-amber-600">
            {orders.reduce((s, r) => s + (r.pending_qty || 0), 0).toFixed(0)}
          </div>
        </div>
      </div>

      {/* Table — red-soft */}
      <div className="card p-6" style={{ background: 'var(--red-soft)', border: '1px solid #fecaca', position: 'relative' }}>
        <KpiInfoButton info={{ title: 'Purchase Orders List', what: 'All oil/material purchase contracts. New entries via "+ New PO" form.', source: 'Supabase', tables: ['oil_contracts'] }} />
        <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-base font-bold">Material &amp; oil purchases</span>
              <span className="badge" style={{ background: '#E0E7FF', color: '#4338CA', fontWeight: 700, fontSize: 10 }}>⟳ BUSY API</span>
            </div>
            <div className="text-xs text-slate-500">Oil &amp; raw-material vendor POs · synced from BUSY accounting — separate from the maintenance flow</div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button className="btn-ghost pill px-4 py-2 font-semibold text-sm flex items-center gap-2" onClick={handleExport}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              Export
            </button>
            <button className="btn-accent pill px-4 py-2 font-semibold text-sm" onClick={() => setOpen(true)}>
              + New PO
            </button>
          </div>
        </div>
        {/* BUSY integration status — these POs will auto-sync from BUSY; manual entry is the stopgap until then. */}
        <div className="mb-4 rounded-xl px-3 py-2 text-[11px] flex items-center gap-2" style={{ background: '#EEF2FF', border: '1px solid #C7D2FE', color: '#4338CA' }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#F59E0B', display: 'inline-block' }} />
          <span><b>BUSY sync: not connected yet.</b> Oil/material vendor POs will flow in automatically once the BUSY API is wired. Until then, add them manually with “+ New PO”.</span>
        </div>
        {loadError ? (
          <ErrorState title="Couldn't load purchase orders" message="The purchase order records failed to load."
            onRetry={() => { setLoading(true); setLoadError(false); load(); }} />
        ) : loading ? (
          <SkeletonRows rows={6} />
        ) : (
        <div className="overflow-x-auto scroll-x">
          <table className="dt">
            <thead>
              <tr>
                <th>Oil / Material</th><th>Paraffin type</th><th>Company</th>
                <th>Port / Dest</th><th className="num">Booked (MT)</th>
                <th className="num">Dispatched (MT)</th><th className="num">Pending (MT)</th>
                <th className="num">Price (₹)</th><th>Date</th>
              </tr>
            </thead>
            <tbody>
              {list.map(r => (
                <tr key={r.id} style={{ cursor: 'pointer' }}>
                  <td className="font-semibold">{r.oil_type || '—'}</td>
                  <td className="text-slate-500">{r.paraffin_type || '—'}</td>
                  <td>{r.company || '—'}</td>
                  <td>{r.port || '—'}</td>
                  <td className="num">{r.book_qty_mt ?? '—'}</td>
                  <td className="num text-green-700">{r.dispatched_qty ?? '—'}</td>
                  <td className="num text-amber-700">{r.pending_qty ?? '—'}</td>
                  <td className="num font-semibold">{r.price ? `₹ ${Number(r.price).toLocaleString('en-IN')}` : '—'}</td>
                  <td className="text-slate-500 text-xs">{r.date || '—'}</td>
                </tr>
              ))}
              {list.length === 0 && (
                <tr><td colSpan={9} className="text-center text-slate-400 py-6 text-sm">No purchase orders yet — add the first one</td></tr>
              )}
            </tbody>
          </table>
        </div>
        )}
      </div>

      {/* ── Maintenance purchases (derived from the maintenance flow) ─────────── */}
      <div className="card p-6 mt-5">
        <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-base font-bold">Maintenance purchases</span>
            <span className="badge" style={{ background: '#DCFCE7', color: '#15803D', fontWeight: 700, fontSize: 10 }}>⚙ from maintenance workflow</span>
          </div>
          <div className="text-xs num font-bold text-slate-700">Total ₹ {maintPOs.reduce((s, m) => s + (m.total || 0), 0).toLocaleString('en-IN')}</div>
        </div>
        <div className="text-xs text-slate-500 mb-4">Spare parts not in store → bought externally · auto-pulled from the maintenance workflow (in sync, no manual entry)</div>
        <div className="overflow-x-auto scroll-x">
          <table className="dt">
            <thead><tr><th>Ticket</th><th>Part</th><th>Equipment</th><th>Store / unit</th><th>Supplier</th><th className="num">Qty</th><th className="num">Unit price</th><th className="num">Total</th><th>BUSY ref</th><th>Date</th></tr></thead>
            <tbody>
              {maintPOs.length === 0 && (
                <tr><td colSpan={10} className="text-center text-slate-400 py-6 text-sm">No external maintenance buys yet — they appear here when the Purchase Manager bills a part that wasn’t in store.</td></tr>
              )}
              {maintPOs.map(m => (
                <tr key={m.id}>
                  <td className="num text-xs text-slate-500">#{m.ticketRef}</td>
                  <td className="font-semibold">{m.part}</td>
                  <td className="text-slate-500 text-xs">{m.equipment}</td>
                  <td className="text-slate-500 text-xs">{m.store}</td>
                  <td>{m.supplier}</td>
                  <td className="num">{m.qty}</td>
                  <td className="num">{m.unitPrice != null ? `₹ ${m.unitPrice.toLocaleString('en-IN')}` : '—'}</td>
                  <td className="num font-semibold">{m.total != null ? `₹ ${m.total.toLocaleString('en-IN')}` : '—'}</td>
                  <td className="text-slate-500 text-xs">{m.busyRef || '—'}</td>
                  <td className="text-slate-500 text-xs">{m.date ? new Date(m.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      <SlidePanel open={open} onClose={handleClose} title="New purchase order" subtitle="Purchase Orders · Purchase">
        <PanelSection title="Order details">
          <PanelRow>
            <PanelField label="Material / oil type *">
              <PanelInput placeholder="e.g. Paraffin (NP), C18 olefin" value={form.material} onChange={e => set('material', e.target.value)} />
            </PanelField>
            <PanelField label="Supplier *">
              <PanelInput placeholder="e.g. Reliance Industries Ltd" value={form.supplier} onChange={e => set('supplier', e.target.value)} />
            </PanelField>
          </PanelRow>

          <PanelRow cols={3}>
            <PanelField label="Port / destination">
              <PanelSelect value={form.destination} onChange={e => set('destination', e.target.value)}>
                {PLANTS.map(p => <option key={p}>{p}</option>)}
                <option>Kandla</option>
                <option>Mundra</option>
                <option>Port</option>
              </PanelSelect>
            </PanelField>
            <PanelField label="Unit">
              <PanelSelect value={form.unit} onChange={e => set('unit', e.target.value)}>
                {UNITS.map(u => <option key={u}>{u}</option>)}
              </PanelSelect>
            </PanelField>
          </PanelRow>

          <PanelRow>
            <PanelField label="Quantity (MT)">
              <PanelInput type="number" placeholder="e.g. 500" value={form.qty} onChange={e => set('qty', e.target.value)} />
            </PanelField>
            <PanelField label="Price (₹)">
              <PanelInput placeholder="e.g. ₹ 4,20,000" value={form.value} onChange={e => set('value', e.target.value)} />
            </PanelField>
          </PanelRow>

          <PanelField label="Notes / special instructions">
            <PanelTextarea placeholder="Brand specifications, delivery deadline, quality requirements…" value={form.notes} onChange={e => set('notes', e.target.value)} />
          </PanelField>
        </PanelSection>

        <PanelDivider />

        <OcrUpload
          label="Quote / PO document"
          hint="Upload supplier quote or draft PO — AI extracts items, rates, totals"
          fields={[
            { key: 'supplier',  label: 'Supplier',        value: 'Indo Gulf Fertilisers Ltd' },
            { key: 'material',  label: 'Material / Item',  value: 'PP Granules H110MA' },
            { key: 'qty',       label: 'Quantity',         value: '500' },
            { key: 'unit',      label: 'Unit',             value: 'MT' },
            { key: 'value',     label: 'Est. Value (₹)',   value: '42,00,000' },
          ]}
          onExtracted={data => {
            if (data.supplier) set('supplier', data.supplier);
            if (data.material) set('material', data.material);
            if (data.qty)      set('qty', data.qty);
            if (data.unit)     set('unit', data.unit);
            if (data.value)    set('value', data.value);
          }}
        />

        <PanelFooter
          saved={saved}
          onCancel={handleClose}
          onSave={handleSave}
          saveLabel="Create PO"
          successLabel="PO created"
          successSub="Sent to Vijay Ji for authorisation"
          disabled={!form.material.trim() || !form.supplier.trim()}
          requiredHint="Fill in Material and Supplier to create PO"
        />
      </SlidePanel>
    </>
  );
}
