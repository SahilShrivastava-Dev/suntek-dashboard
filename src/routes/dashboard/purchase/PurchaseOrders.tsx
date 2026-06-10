import React, { useState } from 'react';
import { REQUIREMENTS } from '../../../data/mockData';
import { exportToXlsx } from '../../../lib/utils/exportXlsx';
import { useRoleContext } from '../../../contexts/RoleContext';
import { SlidePanel, PanelField, PanelInput, PanelSelect, PanelTextarea, PanelRow, PanelDivider, PanelSection, OcrUpload, PanelFooter } from '../../../components/SlidePanel';
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

const PLANTS = ['SHD', 'Rehla', 'Ganjam', 'HQ'];
const UNITS  = ['nos', 'kg', 'MT', 'L', 'sets', 'boxes'];

export function PurchaseOrders() {
  const [filter, setFilter] = useState('all');
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const { activeProfile } = useRoleContext();
  const [form, setForm] = useState({ material: '', type: 'PO', supplier: '', destination: 'SHD', qty: '', unit: 'nos', value: '', notes: '' });

  function set(k: string, v: string) { setForm(f => ({ ...f, [k]: v })); }

  function handleSave() {
    if (!form.material.trim() || !form.supplier.trim()) return;
    setSaved(true);
    setTimeout(() => { setOpen(false); setSaved(false); setForm({ material: '', type: 'PO', supplier: '', destination: 'SHD', qty: '', unit: 'nos', value: '', notes: '' }); }, 1600);
  }

  function handleClose() { setOpen(false); setSaved(false); }

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

  const list = filter === 'all' ? REQUIREMENTS : REQUIREMENTS.filter(r => r.status === filter);

  return (
    <>
      {/* KPI row */}
      <div className="grid grid-cols-12 gap-5 mb-5">
        <div className="col-span-12 lg:col-span-3 card p-5" style={{ position: 'relative' }}>
          <KpiInfoButton info={{ title: 'Purchase Spend MTD', what: 'Total value of all purchase orders (PO + small auth) raised or paid this calendar month across all plants. Hardcoded demo value — will be replaced by BUSY VchType=14 data.', source: 'Mock data', note: 'Future: connect to BUSY DB > Tran1 WHERE VchType=14, current month' }} />
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">Spent · this month</div>
          <div className="text-[28px] font-extrabold mt-1 num">₹ 38.42 L</div>
          <div className="text-[11px] text-green-600 mt-1">↓ 4.1% vs Mar</div>
        </div>
        <div className="col-span-12 lg:col-span-3 card p-5" style={{ position: 'relative' }}>
          <KpiInfoButton info={{ title: 'POs Required', what: 'Count of open purchase orders that require formal PO documentation — i.e. Fixed Asset or high-value items. Entered via the "+ New request" form on this page.', source: 'Form entry', formLabel: 'New PO form', formPath: '/dashboard/purchase/purchase', note: 'Mock count — actual POs tracked in REQUIREMENTS mock data for now.' }} />
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">PO required</div>
          <div className="text-[28px] font-extrabold mt-1 num">5</div>
          <div className="text-[11px] text-slate-500 mt-1">on Fixed Assets</div>
        </div>
        <div className="col-span-12 lg:col-span-3 card p-5" style={{ position: 'relative' }}>
          <KpiInfoButton info={{ title: 'Auth-Only (Small) Purchases', what: 'Count of small purchase requests that do not require a formal PO — only manager authorisation. These are below the PO threshold and are tracked in the same REQUIREMENTS list.', source: 'Form entry', formLabel: 'New request form', formPath: '/dashboard/purchase/purchase' }} />
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">Auth-only (small)</div>
          <div className="text-[28px] font-extrabold mt-1 num">7</div>
          <div className="text-[11px] text-slate-500 mt-1">no PO needed</div>
        </div>
        <div className="col-span-12 lg:col-span-3 card p-5" style={{ position: 'relative' }}>
          <KpiInfoButton info={{ title: 'Average Lead Time', what: 'Average number of days from purchase request creation to supplier dispatch/delivery, across all POs this month. Lower is better for production continuity.', source: 'Mock data', note: 'Future: computed from REQUIREMENTS.createdAt vs dispatchedAt timestamps.' }} />
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">Avg lead time</div>
          <div className="text-[28px] font-extrabold mt-1 num">3.2 d</div>
        </div>
      </div>

      {/* Table — red-soft */}
      <div className="card p-6" style={{ background: 'var(--red-soft)', border: '1px solid #fecaca', position: 'relative' }}>
        <KpiInfoButton info={{ title: 'Purchase Orders List', what: 'All active purchase requisitions across all plants. PO-type items require formal approval and are created in BUSY accounting. Small (auth-only) items only need Vijay Ji verbal/written authorisation. Filter by status: Approved / Dispatched / Received.', source: 'Mock data', formLabel: '+ New request form', formPath: '/dashboard/purchase/purchase', note: 'Data from REQUIREMENTS mock (mockData.ts). Future: sync with BUSY purchase module or Supabase.' }} />
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

      {/* Modal */}
      <SlidePanel open={open} onClose={handleClose} title="New purchase order" subtitle="Purchase Orders · Purchase">
        <PanelSection title="Order details">
          <PanelRow>
            <PanelField label="Material / asset *">
              <PanelInput placeholder="e.g. PP Granules, Atlas Copco Filter" value={form.material} onChange={e => set('material', e.target.value)} />
            </PanelField>
            <PanelField label="Supplier *">
              <PanelInput placeholder="e.g. Reliance Industries Ltd" value={form.supplier} onChange={e => set('supplier', e.target.value)} />
            </PanelField>
          </PanelRow>

          <PanelRow cols={3}>
            <PanelField label="PO type">
              <PanelSelect value={form.type} onChange={e => set('type', e.target.value)}>
                <option value="small">Small (auth-only)</option>
                <option value="PO">PO</option>
                <option value="PO (FAR)">PO (Fixed Asset)</option>
              </PanelSelect>
            </PanelField>
            <PanelField label="Destination plant">
              <PanelSelect value={form.destination} onChange={e => set('destination', e.target.value)}>
                {PLANTS.map(p => <option key={p}>{p}</option>)}
              </PanelSelect>
            </PanelField>
            <PanelField label="Unit">
              <PanelSelect value={form.unit} onChange={e => set('unit', e.target.value)}>
                {UNITS.map(u => <option key={u}>{u}</option>)}
              </PanelSelect>
            </PanelField>
          </PanelRow>

          <PanelRow>
            <PanelField label="Quantity">
              <PanelInput type="number" placeholder="e.g. 500" value={form.qty} onChange={e => set('qty', e.target.value)} />
            </PanelField>
            <PanelField label="Estimated value (₹)">
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
            { key: 'supplier',    label: 'Supplier',       value: 'Indo Gulf Fertilisers Ltd' },
            { key: 'material',    label: 'Material / Item', value: 'PP Granules H110MA' },
            { key: 'qty',         label: 'Quantity',        value: '500' },
            { key: 'unit',        label: 'Unit',            value: 'MT' },
            { key: 'value',       label: 'Est. Value (₹)',  value: '42,00,000' },
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
