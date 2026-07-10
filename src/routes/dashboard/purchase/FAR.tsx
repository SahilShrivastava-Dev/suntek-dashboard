import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../../lib/supabase';
import { insertRows } from '../../../lib/db';
import { SlidePanel, PanelField, PanelInput, PanelSelect, PanelRow, PanelDivider, OcrUpload, PanelFooter } from '../../../components/SlidePanel';
import { KpiInfoButton } from '../../../components/KpiInfoButton';
import { useToast } from '../../../components/ui/toast';
import { SkeletonRows, ErrorState } from '../../../components/ui/states';
import { usePagination } from '../../../components/ui/usePagination';
import { TablePagination } from '../../../components/ui/TablePagination';
import { exportToCsv, type CsvColumn } from '../../../lib/utils/exportCsv';
import { uploadWorkflowFile } from '../../../lib/cloudinary';
import * as XLSX from 'xlsx';
import { usePlantScope } from '../../../contexts/PlantScopeContext';
import { withEmbedFallback } from '../../../lib/scopedList';
import { groupAssetsByType, normMark } from '../../../lib/far/assets';
import type { Database } from '../../../lib/database.types';

// ── FAR bulk-import (CSV / Excel → verify → register) ─────────────────────────
interface FarImportRow {
  name: string; mark: string; make: string; serial: string; quantity: string;
  model: string; capacity: string; origin: string;
  year: string; value: string; invoice: string; purchaseDate: string; account: string;
}
const BLANK_FAR_ROW = (): FarImportRow => ({ name: '', mark: '', make: '', serial: '', quantity: '', model: '', capacity: '', origin: '', year: '', value: '', invoice: '', purchaseDate: '', account: '' });
// Order matters — more specific keys first so "Name Of Equipments" ≠ "Identification Mark".
const FAR_HEADER_MAP: { field: keyof FarImportRow; keys: string[] }[] = [
  { field: 'name',         keys: ['name of equip', 'equipment name', 'name of', 'equipment', 'asset name', 'particular', 'description', 'item'] },
  { field: 'mark',         keys: ['identification mark', 'identification', 'id mark', 'mark', 'tag no', 'tag'] },
  { field: 'make',         keys: ['make', 'manufacturer', 'brand'] },
  { field: 'serial',       keys: ['serial'] },
  { field: 'quantity',     keys: ['quantity', 'qty'] },
  { field: 'model',        keys: ['model'] },
  { field: 'capacity',     keys: ['capacity', 'line size', 'size', 'spec'] },
  { field: 'origin',       keys: ['origin', 'country'] },
  { field: 'year',         keys: ['year'] },
  { field: 'value',        keys: ['taxable value', 'value', 'amount', 'cost', 'wdv', 'gross'] },
  { field: 'invoice',      keys: ['invoice'] },
  { field: 'purchaseDate', keys: ['date of purchase', 'purchase date', 'dop'] },
  { field: 'account',      keys: ['account head', 'account', 'category', 'head', 'block'] },
];
function mapHeader(h: string): keyof FarImportRow | null {
  const k = (h || '').toLowerCase().trim();
  if (!k) return null;
  for (const m of FAR_HEADER_MAP) if (m.keys.some(x => k.includes(x))) return m.field;
  return null;
}
function normDate(v: string): string | null {
  if (!v) return null;
  // Excel serial number → date
  if (/^\d{4,5}$/.test(v.trim())) {
    const d = XLSX.SSF ? XLSX.SSF.parse_date_code(Number(v)) : null;
    if (d) return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
  }
  const dt = new Date(v);
  return isNaN(dt.getTime()) ? null : dt.toISOString().slice(0, 10);
}
async function parseFarFile(file: File): Promise<FarImportRow[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  // The client sheet has junk title rows above the real header, so detect the
  // header row (the one with an equipment-name / identification column) rather
  // than assuming row 1.
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '', blankrows: false });
  const hi = rows.findIndex(r => Array.isArray(r) && r.some(c => typeof c === 'string' && /name of equip|identification|equipment name|asset name|particular/i.test(c)));
  if (hi < 0) return [];
  const cols = (rows[hi] as unknown[]).map(c => mapHeader(c == null ? '' : String(c)));
  const out: FarImportRow[] = [];
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i] as unknown[];
    if (!Array.isArray(r)) continue;
    const row = BLANK_FAR_ROW();
    cols.forEach((f, ci) => { if (f && row[f] === '') { const v = r[ci]; row[f] = v == null ? '' : String(v).trim(); } });
    if (row.name || row.mark || row.value) out.push(row);
  }
  return out;
}
const IMPORT_CSV_COLUMNS: CsvColumn[] = [
  { header: 'Identification mark', key: 'mark' }, { header: 'Model', key: 'model' },
  { header: 'Capacity', key: 'capacity' }, { header: 'Origin', key: 'origin' },
  { header: 'Year', key: 'year' }, { header: 'Taxable value', key: 'value' },
  { header: 'Invoice no', key: 'invoice' }, { header: 'Date of purchase', key: 'purchaseDate' },
  { header: 'Account head', key: 'account' },
];

type AssetRow = Database['public']['Tables']['fixed_assets']['Row'] & { plants?: { name: string | null } | null };
type MaintTicketRow = Database['public']['Tables']['maintenance_tickets']['Row'] & { plants?: { name: string | null } | null };
type MaintStoreReqRow = Database['public']['Tables']['maintenance_store_requests']['Row'];

/** A single repair/maintenance done — the unit of the annual FAR cost register. */
interface MaintEntry {
  id: string;
  equipment: string;
  plant: string;
  part: string;
  cost: number;
  procuredQty: number;
  billUrl: string | null;
  status: string;
  created_at: string;
  closed_at: string | null;
  busyRef: string | null;
  fy: string;
}

/** Indian financial year (Apr–Mar) label for a date, e.g. "FY2025-26". */
function fyOf(d: string | null | undefined): string {
  if (!d) return 'Unknown';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return 'Unknown';
  const y = dt.getFullYear();
  const apr = dt.getMonth() >= 3; // month 3 = April
  const start = apr ? y : y - 1;
  return `FY${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

function fmtDT(d: string | null | undefined): string {
  return d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
}
function inr(n: number): string { return `₹ ${Math.round(n).toLocaleString('en-IN')}`; }
function cr(n: number): string { return `₹ ${(n / 1e7).toFixed(2)} Cr`; }

// Annual asset-insurance cover (₹). Asset purchases + maintenance procurement for
// the financial year are deducted against this cover; any spend beyond it is paid
// out of pocket. Kept as a constant for now — wire to a per-policy-year source later.
const INSURANCE_COVERAGE = 38.4e7; // ₹38.4 Cr

const MAINT_CSV_COLUMNS: CsvColumn[] = [
  { header: 'Ticket #', key: 'ticket' },
  { header: 'Equipment', key: 'equipment' },
  { header: 'Plant', key: 'plant' },
  { header: 'Part / type', key: 'part' },
  { header: 'Status', key: 'status' },
  { header: 'Raised at', key: 'created' },
  { header: 'Closed at', key: 'closed' },
  { header: 'BUSY ref', key: 'busy' },
  { header: 'Cost (INR)', key: 'cost' },
];

function PicBadge({ has }: { has: boolean }) {
  const { t } = useTranslation();
  return (
    <span
      className={`pic-badge${has ? '' : ' missing'}`}
      title={has ? t('far.picOnFile') : t('far.noPicYet')}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
        <circle cx="12" cy="13" r="4"/>
      </svg>
    </span>
  );
}

const PLANTS = ['SHD', 'Rehla', 'Ganjam', 'HQ'];
const ACCOUNT_HEADS = ['Plant & Machinery', 'Electrical Equipment', 'Vehicles', 'Furniture & Fixtures', 'Computer & Peripherals', 'Office Equipment'];

export function FAR() {
  const { t } = useTranslation();
  const toast = useToast();
  const { scopeQuery, allowedPlants } = usePlantScope();
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [expandedType, setExpandedType] = useState<string | null>(null);
  const [equipSearch, setEquipSearch] = useState('');
  const [equipPlantFilter, setEquipPlantFilter] = useState<string[]>([]); // empty = all plants (combined)
  const [equipOpenTable, setEquipOpenTable] = useState(false);            // the big list is hidden until asked
  const [equipSort, setEquipSort] = useState<{ key: 'type' | 'count'; dir: 'asc' | 'desc' }>({ key: 'type', dir: 'asc' });
  const [dbPlants, setDbPlants] = useState<{ id: string; name: string }[]>([]);
  const [importPlantIds, setImportPlantIds] = useState<string[]>([]); // factories this FAR belongs to (multi-select)
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  // Maintenance/repair cost register (annual, for insurance)
  const [maintEntries, setMaintEntries] = useState<MaintEntry[]>([]);
  const [selectedFY, setSelectedFY] = useState<string | null>(null);
  const [drillEntry, setDrillEntry] = useState<MaintEntry | null>(null);
  // Bulk import accordion
  const [importOpen, setImportOpen] = useState(false);
  const [importStage, setImportStage] = useState<'idle' | 'uploading' | 'parsing' | 'review' | 'importing' | 'done' | 'error'>('idle');
  const [parsedRows, setParsedRows] = useState<FarImportRow[]>([]);
  const [importError, setImportError] = useState<string | null>(null);
  const [importedCount, setImportedCount] = useState(0);
  const [cloudUrl, setCloudUrl] = useState<string | null>(null);
  const [importFileName, setImportFileName] = useState('');
  const importInputRef = useRef<HTMLInputElement>(null);
  const today = new Date().toISOString().split('T')[0];
  const [form, setForm] = useState({
    mark: '', model: '', capacity: '', origin: 'India',
    year: new Date().getFullYear().toString(),
    value: '', invoice: '', purchaseDate: today,
    account: 'Plant & Machinery', plant: 'SHD',
  });

  async function load() {
    try {
      const { data: plantsData } = await supabase.from('plants').select('id, name')
        .returns<{ id: string; name: string }[]>();
      if (plantsData && plantsData.length > 0) setDbPlants(plantsData);

      const { data, error } = await withEmbedFallback(
        scopeQuery(supabase.from('fixed_assets').select('*, plants(name)')).order('created_at', { ascending: false }).returns<AssetRow[]>(),
        () => scopeQuery(supabase.from('fixed_assets').select('*')).order('created_at', { ascending: false }).returns<AssetRow[]>(),
        'FAR.assets',
      );
      if (error) throw error;
      setAssets(data || []);
      setLoadError(false);

      // Maintenance/repair cost register — emergency tickets + their part costs.
      const { data: tickets } = await supabase.from('maintenance_tickets')
        .select('*, plants(name)').eq('type', 'emergency')
        .order('created_at', { ascending: false }).returns<MaintTicketRow[]>();
      const ids = (tickets || []).map((tk) => tk.id);
      let srs: MaintStoreReqRow[] = [];
      if (ids.length) {
        const { data: srData } = await supabase.from('maintenance_store_requests')
          .select('*').in('ticket_id', ids).returns<MaintStoreReqRow[]>();
        srs = srData || [];
      }
      const srByTicket = new Map<string, MaintStoreReqRow[]>();
      srs.forEach((s) => { if (!s.ticket_id) return; const arr = srByTicket.get(s.ticket_id); if (arr) arr.push(s); else srByTicket.set(s.ticket_id, [s]); });
      const entries: MaintEntry[] = (tickets || []).map((tk) => {
        const rows = srByTicket.get(tk.id) ?? [];
        const primary = rows[0];
        const procuredRows = rows.filter(r => r.store_decision === 'unavailable' || r.purchase_required);
        const procuredQty = procuredRows.reduce((n, r) => n + (Number(r.quantity) || 0), 0);
        // Cost = the Purchase Manager's aggregate bill for this ticket, else any per-row prices.
        const rowCost = rows.reduce((n, r) => n + (Number(r.total_price) || 0), 0);
        const cost = Number(tk.pm_bill_total) || rowCost || 0;
        const when = tk.closed_at || tk.created_at;
        return {
          id: tk.id,
          equipment: tk.equipment,
          plant: tk.plants?.name || '—',
          part: primary?.part_name || 'In-house repair',
          cost,
          procuredQty,
          billUrl: tk.pm_bill_url ?? null,
          status: tk.status,
          created_at: tk.created_at,
          closed_at: tk.closed_at,
          busyRef: procuredRows[0]?.busy_transaction_ref ?? primary?.busy_transaction_ref ?? null,
          fy: fyOf(when),
        };
      });
      setMaintEntries(entries);
    } catch (err) {
      console.error('[FAR] load failed', err);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [scopeQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  const plantNames = dbPlants.length > 0 ? dbPlants.map(p => p.name) : PLANTS;

  // Plants present in the FAR → the combine/individual filter chips.
  const plantsInFar = useMemo(() => {
    const seen = new Map<string, string>();
    for (const a of assets) if (a.plant_id) seen.set(a.plant_id, a.plants?.name || a.plant_id);
    return [...seen.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [assets]);

  // Equipment List — a derived, grouped view of the FAR (the PM master).
  const equipGroups = useMemo(() => {
    const q = equipSearch.trim().toLowerCase();
    let filtered = assets;
    if (equipPlantFilter.length) filtered = filtered.filter(a => a.plant_id && equipPlantFilter.includes(a.plant_id));
    if (q) filtered = filtered.filter(a => (a.name || '').toLowerCase().includes(q) || normMark(a.identification_mark).includes(normMark(q)));
    return groupAssetsByType(filtered);
  }, [assets, equipSearch, equipPlantFilter]);
  const sortedGroups = useMemo(() => {
    const dir = equipSort.dir === 'asc' ? 1 : -1;
    return [...equipGroups].sort((a, b) => equipSort.key === 'count' ? (a.count - b.count) * dir : a.type.localeCompare(b.type) * dir);
  }, [equipGroups, equipSort]);
  function toggleEquipSort(key: 'type' | 'count') {
    setEquipSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'count' ? 'desc' : 'asc' });
  }
  const eqArrow = (key: 'type' | 'count') => equipSort.key === key ? (equipSort.dir === 'asc' ? ' ▲' : ' ▼') : '';
  // Representative (most common non-empty) value for a group column.
  const repVal = (vals: (string | number | null)[]) => {
    const counts = new Map<string, number>();
    for (const v of vals) { const s = v == null ? '' : String(v).trim(); if (s) counts.set(s, (counts.get(s) || 0) + 1); }
    if (!counts.size) return { text: '—', mixed: false };
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    return { text: sorted[0][0], mixed: counts.size > 1 };
  };

  // ── Maintenance cost register, grouped by financial year ──────────────────
  const fyList = useMemo(
    () => [...new Set(maintEntries.map(e => e.fy))].filter(fy => fy !== 'Unknown').sort().reverse(),
    [maintEntries],
  );
  useEffect(() => { if (!selectedFY && fyList.length) setSelectedFY(fyList[0]); }, [fyList, selectedFY]);
  const activeFY = selectedFY || fyList[0] || null;
  const fyEntries = useMemo(
    () => maintEntries.filter(e => e.fy === activeFY)
      .sort((a, b) => (b.closed_at || b.created_at).localeCompare(a.closed_at || a.created_at)),
    [maintEntries, activeFY],
  );
  const fyTotal = fyEntries.reduce((s, e) => s + e.cost, 0);
  const fyLastUpdated = fyEntries.reduce((mx, e) => { const d = e.closed_at || e.created_at; return d > mx ? d : mx; }, '');

  // Pagination (default 10/page) for the FAR register + the FY maintenance table.
  const groupPg = usePagination(sortedGroups, { resetKey: sortedGroups.length });
  const fyPg = usePagination(fyEntries, { resetKey: activeFY ?? '' });

  // ── Insurance deduction math (for the displayed financial year) ───────────────
  // Deduction = capital assets bought in the FY + maintenance/repair procurement.
  // Coverage − deduction = headroom left; negative = paid out of pocket.
  const currentFY = fyOf(today);
  const displayFY = activeFY || currentFY;
  const fyAssetSpend = useMemo(
    () => assets.filter(a => fyOf(a.purchase_date) === displayFY).reduce((s, a) => s + (Number(a.value) || 0), 0),
    [assets, displayFY],
  );
  const fyDeduction = fyAssetSpend + fyTotal;
  const fyRemaining = INSURANCE_COVERAGE - fyDeduction;
  const fyOverage = Math.max(0, -fyRemaining);

  function downloadMaintCsv() {
    if (!activeFY) return;
    const rows = fyEntries.map(e => ({
      ticket: e.id.slice(0, 8), equipment: e.equipment, plant: e.plant, part: e.part,
      status: e.status, created: fmtDT(e.created_at), closed: fmtDT(e.closed_at),
      busy: e.busyRef || '', cost: Math.round(e.cost),
    }));
    const preamble: (string | number)[][] = [
      ['Suntek — Maintenance & Repairs Register'],
      ['Financial year', activeFY],
      ['Total maintenance cost (insurance deduction)', inr(fyTotal)],
      ['Entries', fyEntries.length],
      ['Generated at', new Date().toLocaleString('en-IN')],
    ];
    exportToCsv(`maintenance-register-${activeFY}`, MAINT_CSV_COLUMNS, rows, preamble);
  }

  // ── Bulk import: file → cloud copy → AI parse → verify → register ─────────
  function resetImport() {
    setImportStage('idle'); setParsedRows([]); setImportError(null);
    setImportedCount(0); setCloudUrl(null); setImportFileName(''); setImportPlantIds([]);
  }
  async function handleImportFile(file: File) {
    setImportError(null); setImportFileName(file.name); setParsedRows([]);
    setImportStage('uploading');
    try {
      // 1. Keep a copy of the original file in the cloud (reference).
      try {
        const up = await uploadWorkflowFile(file, { workflow: 'general', subfolder: 'far-imports', kind: 'far', creator: 'admin' });
        setCloudUrl(up.secure_url);
      } catch { /* cloud copy is best-effort */ }

      // 2. Extract the rows.
      setImportStage('parsing');
      const isSheet = /\.(csv|xlsx|xls)$/i.test(file.name);
      if (!isSheet) {
        throw new Error(t('far.errImagePdf'));
      }
      await new Promise((r) => setTimeout(r, 800)); // brief AI-reading step
      const rows = await parseFarFile(file);
      if (!rows.length) throw new Error(t('far.errNoRows'));
      setParsedRows(rows);
      // Pre-select the factory only when there's exactly one option; else force a choice.
      const opts = allowedPlants.length ? allowedPlants : dbPlants;
      setImportPlantIds(opts.length === 1 ? [opts[0].id] : []);
      setImportStage('review');
    } catch (e) {
      setImportError(e instanceof Error ? e.message : String(e));
      setImportStage('error');
    }
  }
  async function confirmImport() {
    if (!importPlantIds.length) { setImportError('Select at least one factory this FAR belongs to.'); setImportStage('error'); return; }
    setImportStage('importing');
    try {
      // A shared FAR can cover several factories → register the assets for each.
      const payload = importPlantIds.flatMap((plantId) => parsedRows.map((r) => ({
        plant_id: plantId,
        name: r.name || r.mark || r.model || 'Unnamed asset',
        identification_mark: r.mark || null,
        make: r.make || null,
        serial_no: r.serial || null,
        quantity: r.quantity ? (parseFloat(String(r.quantity).replace(/[^0-9.]/g, '')) || null) : null,
        model: r.model || null,
        capacity: r.capacity || null,
        origin: r.origin || null,
        year: r.year ? (parseInt(r.year) || null) : null,
        value: r.value ? (parseFloat(String(r.value).replace(/[^0-9.]/g, '')) || null) : null,
        invoice_no: r.invoice || null,
        purchase_date: normDate(r.purchaseDate),
        account_head: r.account || null,
      })));
      const { error } = await insertRows('fixed_assets', payload);
      if (error) throw error;
      setImportedCount(payload.length);
      setImportStage('done');
      await load();
    } catch (e) {
      setImportError(e instanceof Error ? e.message : String(e));
      setImportStage('error');
    }
  }
  function downloadImportCsv() {
    exportToCsv(`far-import-${today}`, IMPORT_CSV_COLUMNS, parsedRows as unknown as Record<string, unknown>[], [
      ['Suntek — FAR Import (AI-extracted)'],
      ['Source file', importFileName],
      ['Cloud copy', cloudUrl || '—'],
      ['Rows', parsedRows.length],
      ['Generated at', new Date().toLocaleString('en-IN')],
    ]);
  }

  function set(k: string, v: string) { setForm(f => ({ ...f, [k]: v })); }

  function handleOcr(data: Record<string, string>) {
    setForm(f => ({
      ...f,
      ...(data.invoice  ? { invoice: data.invoice }     : {}),
      ...(data.value    ? { value: data.value }          : {}),
      ...(data.model    ? { model: data.model }          : {}),
      ...(data.capacity ? { capacity: data.capacity }    : {}),
      ...(data.purchaseDate ? { purchaseDate: data.purchaseDate } : {}),
      // Auto-fill identification mark from model if not already set
      ...(data.model && !f.mark ? { mark: data.model } : {}),
    }));
  }

  async function handleSave() {
    if (!form.mark.trim() || !form.model.trim()) return;
    const plant = dbPlants.find(p => p.name === form.plant);
    const plantId = plant?.id || dbPlants[0]?.id || null;
    const { data, error } = await insertRows('fixed_assets', {
      plant_id: plantId,
      name: form.mark,
      identification_mark: form.mark,
      model: form.model || null,
      capacity: form.capacity || null,
      origin: form.origin || null,
      year: parseInt(form.year) || null,
      value: form.value ? parseFloat(form.value.replace(/[^0-9.]/g, '')) : null,
      invoice_no: form.invoice || null,
      purchase_date: form.purchaseDate || null,
      account_head: form.account || null,
    }).select('*, plants(name)').single();

    if (error) {
      toast.error(`${t('far.saveFailed')}: ${error.message}`);
      return;
    }
    if (data) setAssets(prev => [data as AssetRow, ...prev]);
    setSaved(true);
    setTimeout(() => { setOpen(false); setSaved(false); setForm({ mark: '', model: '', capacity: '', origin: 'India', year: new Date().getFullYear().toString(), value: '', invoice: '', purchaseDate: today, account: 'Plant & Machinery', plant: 'SHD' }); }, 1600);
  }

  function handleClose() { setOpen(false); setSaved(false); }

  return (
    <>
      {/* KPI row */}
      <div className="grid grid-cols-12 gap-5 mb-5">
        <div className="col-span-12 lg:col-span-3 card p-5" style={{ position: 'relative' }}>
          <KpiInfoButton info={{ title: 'Total Fixed Assets', what: 'Count of all capitalised fixed assets registered across all 4 factory plants (SHD, Rehla, Ganjam, HQ). Each asset is named and tracked in the FAR.', source: 'Form entry', formLabel: 'Add Asset form', formPath: '/dashboard/purchase/far', note: 'Stored in FAR_DATA mock; future target: Supabase fixed_assets table.' }} />
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">{t('far.totalFixedAssets')}</div>
          <div className="text-[28px] font-extrabold mt-1 num">{assets.length}</div>
          <div className="text-[11px] text-slate-500 mt-1">{t('far.across4Factories')}</div>
        </div>
        <div className="col-span-12 lg:col-span-3 card p-5" style={{ position: 'relative' }}>
          <KpiInfoButton info={{ title: 'Insurance Coverage', what: `Annual insurance cover (${cr(INSURANCE_COVERAGE)}). Capital asset purchases plus maintenance/repair procurement for the financial year are deducted against this cover. If total spend exceeds the cover, the excess is paid out of pocket.`, source: 'Derived', note: 'Coverage − (FY asset spend + FY repair procurement) = headroom. FY repairs come from the maintenance workflow; asset spend from FAR purchase values.' }} />
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">{t('far.insuranceCoverage')} · {displayFY}</div>
          <div className="text-[28px] font-extrabold mt-1 num">{cr(INSURANCE_COVERAGE)}</div>
          {fyRemaining >= 0
            ? <div className="text-[11px] text-green-600 mt-1">{t('far.leftUsed', { left: cr(fyRemaining), used: cr(fyDeduction) })}</div>
            : <div className="text-[11px] text-red-600 mt-1 font-semibold">⚠ {t('far.overOutOfPocket', { amt: cr(fyOverage) })}</div>}
        </div>
        <div className="col-span-12 lg:col-span-3 card p-5" style={{ position: 'relative' }}>
          <KpiInfoButton info={{ title: 'Assets Flagged for Repair', what: 'Count of fixed assets that have been flagged as requiring repair or maintenance and are awaiting resolution. High count = production downtime risk.', source: 'Form entry', formLabel: 'Add Asset form', formPath: '/dashboard/purchase/far', note: 'Assets with repair flag set in FAR_DATA.' }} />
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">{t('far.repairFlagged')}</div>
          <div className="text-[28px] font-extrabold mt-1 num text-amber-600">{maintEntries.filter(e => e.status !== 'closed').length}</div>
          <div className="text-[11px] text-amber-600 mt-1">{t('far.awaitingClosure')}</div>
        </div>
        <div className="col-span-12 lg:col-span-3 card p-5" style={{ position: 'relative' }}>
          <KpiInfoButton info={{ title: 'Pic-Proof Coverage', what: 'Percentage of registered assets that have a photo on file as proof of existence. Required for insurance claims and audits. Target 100%.', source: 'Form entry', formLabel: 'Add Asset form (OCR upload)', formPath: '/dashboard/purchase/far', note: 'Photo attached during asset registration via the OCR uploader in the slide panel.' }} />
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">{t('far.picProofCoverage')}</div>
          <div className="text-[28px] font-extrabold mt-1 num">95%</div>
          <div className="progress mt-2"><div style={{ width: '95%' }}></div></div>
        </div>
      </div>

      {/* ── Maintenance & Repairs by Financial Year ─────────────────────────── */}
      <div className="card p-6 mb-5">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
          <div>
            <div className="text-base font-bold">{t('far.maintRepairsTitle')}</div>
            <div className="text-xs text-slate-500">{t('far.maintRepairsSubtitle')}</div>
          </div>
          <button onClick={downloadMaintCsv} disabled={!fyEntries.length} className="chip" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, opacity: fyEntries.length ? 1 : 0.5 }}>
            ⬇ {t('far.downloadCsvReport')}
          </button>
        </div>

        {/* Financial-year chips */}
        <div className="flex gap-2 mb-4 flex-wrap">
          {fyList.length === 0
            ? <span className="text-xs text-slate-400">{t('far.noMaintRecorded')}</span>
            : fyList.map(fy => (
              <button key={fy} onClick={() => setSelectedFY(fy)} className={`chip${activeFY === fy ? ' active' : ''}`}>{fy}</button>
            ))}
        </div>

        {activeFY && (
          <>
            {/* Aggregate row */}
            <div className="grid grid-cols-12 gap-4 mb-4">
              <div className="col-span-12 sm:col-span-4 rounded-xl border border-slate-100 p-4" style={{ background: '#F8FAFC' }}>
                <div className="text-[11px] text-slate-500 uppercase tracking-wider">{t('far.repairCost')} · {activeFY}</div>
                <div className="text-[24px] font-extrabold mt-1 num text-slate-800">{inr(fyTotal)}</div>
                {fyRemaining >= 0
                  ? <div className="text-[11px] text-green-600 mt-1">{t('far.insuranceCoverLeft', { amt: cr(fyRemaining) })}</div>
                  : <div className="text-[11px] text-red-600 mt-1 font-semibold">⚠ {t('far.overCoverOutOfPocket', { amt: cr(fyOverage) })}</div>}
              </div>
              <div className="col-span-6 sm:col-span-4 rounded-xl border border-slate-100 p-4" style={{ background: '#F8FAFC' }}>
                <div className="text-[11px] text-slate-500 uppercase tracking-wider">{t('far.maintenanceEntries')}</div>
                <div className="text-[24px] font-extrabold mt-1 num">{fyEntries.length}</div>
              </div>
              <div className="col-span-6 sm:col-span-4 rounded-xl border border-slate-100 p-4" style={{ background: '#F8FAFC' }}>
                <div className="text-[11px] text-slate-500 uppercase tracking-wider">{t('far.lastUpdated')}</div>
                <div className="text-sm font-semibold mt-2 text-slate-700">{fyLastUpdated ? fmtDT(fyLastUpdated) : '—'}</div>
              </div>
            </div>

            <div className="overflow-x-auto scroll-x">
              <table className="dt">
                <thead>
                  <tr><th>{t('far.thTicket')}</th><th>{t('far.thEquipment')}</th><th>{t('far.thPartType')}</th><th>{t('far.thStatus')}</th><th>{t('far.thClosed')}</th><th className="num">{t('far.thCost')}</th></tr>
                </thead>
                <tbody>
                  {fyEntries.length === 0 && (
                    <tr><td colSpan={6} className="text-center text-slate-400 py-6 text-sm">{t('far.noMaintInFy', { fy: activeFY })}</td></tr>
                  )}
                  {fyPg.pageRows.map(e => (
                    <tr key={e.id} onClick={() => setDrillEntry(e)} style={{ cursor: 'pointer' }}>
                      <td className="num text-xs text-slate-500">#{e.id.slice(0, 8)}</td>
                      <td className="font-semibold text-slate-700">{e.equipment}</td>
                      <td className="text-slate-500 text-xs">{e.part}</td>
                      <td className="text-slate-500 text-xs">{e.status.replace(/_/g, ' ')}</td>
                      <td className="text-slate-500 text-xs">{e.closed_at ? fmtDT(e.closed_at) : '—'}</td>
                      <td className="num font-semibold">{e.cost ? inr(e.cost) : '—'}</td>
                    </tr>
                  ))}
                  {fyEntries.length > 0 && (
                    <tr style={{ borderTop: '2px solid #E2E8F0' }}>
                      <td colSpan={5} className="font-bold text-right pr-4">{t('far.total')} · {activeFY}</td>
                      <td className="num font-extrabold text-slate-800">{inr(fyTotal)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <TablePagination controls={fyPg.controls} />
          </>
        )}
      </div>

      {/* FAR table — amber-soft */}
      <div className="card p-6" style={{ background: 'var(--amber-soft)', border: '1px solid #fde68a', position: 'relative' }}>
        <KpiInfoButton info={{ title: 'Fixed Asset Register (FAR)', what: 'Complete list of all capitalized fixed assets across 4 plants. Each asset must be individually named on the FAR to be covered by the marine/fire insurance policy. Photo proof required for audit. New assets added via the "+ Add asset" slide panel.', source: 'Form entry', formLabel: '+ Add asset form', formPath: '/dashboard/purchase/far', note: 'Data from FAR_DATA mock (mockData.ts). Future: Supabase fixed_assets table.' }} />
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div>
            <div className="text-base font-bold">{t('far.fixedAssetRegister')}</div>
            <div className="text-xs text-slate-500">Equipment master for Preventive Maintenance — grouped by type · {equipGroups.length} types · {assets.length} assets</div>
          </div>
          <div className="flex items-center gap-2">
            <button className="chip" onClick={() => { setImportOpen(o => !o); if (importStage === 'done') resetImport(); }} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              ⬆ {t('far.importCsvExcel')}
            </button>
            <button className="btn-accent pill px-4 py-2 font-semibold text-sm" onClick={() => setOpen(true)}>
              + {t('far.registerAsset')}
            </button>
          </div>
        </div>

        {/* Bulk-import accordion */}
        {importOpen && (
          <div style={{ border: '1px dashed #F59E0B', background: '#FFFBEB', borderRadius: 14, padding: 16, marginBottom: 16 }}>
            <input ref={importInputRef} type="file" accept=".csv,.xlsx,.xls,image/*,application/pdf" style={{ display: 'none' }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImportFile(f); e.target.value = ''; }} />

            {(importStage === 'idle' || importStage === 'error') && (
              <>
                <div onClick={() => importInputRef.current?.click()}
                  style={{ cursor: 'pointer', border: '2px dashed #FCD34D', borderRadius: 12, padding: '20px', textAlign: 'center', background: '#FEFCE8' }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#92400E' }}>⬆ {t('far.uploadPrevYearSheet')}</div>
                  <div style={{ fontSize: 12, color: '#A16207', marginTop: 4 }}>{t('far.uploadHint')}</div>
                </div>
                {importError && <div style={{ marginTop: 10, fontSize: 12, color: '#DC2626', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, padding: '10px 12px' }}>{importError}</div>}
              </>
            )}

            {(importStage === 'uploading' || importStage === 'parsing' || importStage === 'importing') && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 4px' }}>
                <svg className="animate-spin" width="22" height="22" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="#FDE68A" strokeWidth="3" /><path d="M12 2 A10 10 0 0 1 22 12" stroke="#D97706" strokeWidth="3" strokeLinecap="round" /></svg>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#92400E' }}>
                  {importStage === 'uploading' ? `☁ ${t('far.savingToCloud')}`
                    : importStage === 'parsing' ? `🤖 ${t('far.aiReadingSheet')}`
                    : `🤖 ${t('far.registeringAssets', { count: parsedRows.length })}`}
                </div>
              </div>
            )}

            {importStage === 'review' && (
              <>
                <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                  <div style={{ fontSize: 12.5, color: '#92400E', fontWeight: 700 }}>
                    🤖 {t('far.assetsExtractedFrom', { count: parsedRows.length })} <strong>{importFileName}</strong> — {t('far.verifyEditRegister')}
                  </div>
                  <button onClick={downloadImportCsv} className="chip">⬇ {t('far.downloadExtractedCsv')}</button>
                </div>
                {/* Which factory/factories does this FAR belong to? (multi-select — a shared FAR can cover several) */}
                <div style={{ border: '1px solid #FDE68A', background: '#FFFDF5', borderRadius: 10, padding: 12, marginBottom: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#92400E', textTransform: 'uppercase', marginBottom: 6 }}>Factory / factories this FAR belongs to *</div>
                  <div className="flex gap-2 flex-wrap">
                    {(allowedPlants.length ? allowedPlants : dbPlants).map(p => {
                      const on = importPlantIds.includes(p.id);
                      return (
                        <button key={p.id} onClick={() => setImportPlantIds(ids => on ? ids.filter(x => x !== p.id) : [...ids, p.id])}
                          className={`chip${on ? ' active' : ''}`}>{on ? '✓ ' : ''}{p.name}</button>
                      );
                    })}
                  </div>
                  <div style={{ fontSize: 11, color: '#A16207', marginTop: 6 }}>
                    {importPlantIds.length > 1
                      ? `These ${parsedRows.length} assets will be registered for each of the ${importPlantIds.length} selected factories.`
                      : 'Select one, or multiple if this single FAR is shared across factories.'}
                  </div>
                </div>
                <div className="overflow-x-auto scroll-x" style={{ maxHeight: 280 }}>
                  <table className="dt">
                    <thead><tr><th>Equipment</th><th>{t('far.thIdMark')}</th><th>Make</th><th>Serial</th><th>Qty</th><th>{t('far.thModel')}</th><th>{t('far.thYear')}</th><th>{t('far.thTaxableValue')}</th><th>{t('far.thInvoice')}</th><th>{t('far.thPurchaseDate')}</th><th>{t('far.thAccountHead')}</th></tr></thead>
                    <tbody>
                      {parsedRows.map((r, i) => {
                        const upd = (k: keyof FarImportRow, v: string) => setParsedRows(prev => prev.map((x, j) => j === i ? { ...x, [k]: v } : x));
                        const cell = (k: keyof FarImportRow, min = 90) => <td><input value={r[k]} onChange={e => upd(k, e.target.value)} style={{ width: '100%', minWidth: min, padding: '4px 6px', border: '1px solid #FDE68A', borderRadius: 6, fontSize: 12, background: '#fff' }} /></td>;
                        return <tr key={i}>{cell('name', 140)}{cell('mark', 70)}{cell('make')}{cell('serial')}{cell('quantity', 50)}{cell('model')}{cell('year', 60)}{cell('value')}{cell('invoice')}{cell('purchaseDate')}{cell('account')}</tr>;
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="flex gap-2 mt-3">
                  <button onClick={() => resetImport()} className="chip">{t('far.cancel')}</button>
                  <button onClick={confirmImport} disabled={!importPlantIds.length} className="btn-accent pill px-4 py-2 font-semibold text-sm" style={{ background: importPlantIds.length ? '#16A34A' : '#94A3B8', opacity: importPlantIds.length ? 1 : 0.6 }}>
                    ✓ Register {parsedRows.length * Math.max(1, importPlantIds.length)} asset{parsedRows.length * Math.max(1, importPlantIds.length) === 1 ? '' : 's'}
                  </button>
                </div>
              </>
            )}

            {importStage === 'done' && (
              <div style={{ textAlign: 'center', padding: '8px 0' }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: '#15803D' }}>✓ {t('far.assetsImported', { count: importedCount })}</div>
                {cloudUrl && <a href={cloudUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: '#2563EB', display: 'inline-block', marginTop: 6 }}>{t('far.viewSavedFile')} ↗</a>}
                <div><button onClick={() => { resetImport(); setImportOpen(false); }} className="chip" style={{ marginTop: 10 }}>{t('far.done')}</button></div>
              </div>
            )}
          </div>
        )}
        {loadError ? (
          <ErrorState title={t('far.errLoadTitle')} message={t('far.errLoadMessage')} onRetry={() => { setLoading(true); setLoadError(false); load(); }} />
        ) : loading ? (
          <SkeletonRows rows={6} />
        ) : (
          <>
            {/* Summary strip + expand toggle — the big list stays collapsed */}
            <div className="flex items-center justify-between flex-wrap gap-2" style={{ background: '#FFFDF5', border: '1px solid #FDE68A', borderRadius: 12, padding: '10px 14px' }}>
              <div style={{ fontSize: 13, color: '#92400E' }}>
                <strong>{assets.length}</strong> asset{assets.length === 1 ? '' : 's'} · <strong>{equipGroups.length}</strong> equipment type{equipGroups.length === 1 ? '' : 's'}
                {plantsInFar.length > 1 && <span> · {plantsInFar.length} plants</span>}
              </div>
              <button onClick={() => setEquipOpenTable(o => !o)} className="text-sm font-semibold" style={{ color: '#D97706', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
                {equipOpenTable ? 'Hide register ▴' : 'Show register ▾'}
              </button>
            </div>

            {equipOpenTable && (
              <div style={{ marginTop: 14 }}>
                {plantsInFar.length > 1 && (
                  <div className="flex gap-2 mb-3 flex-wrap">
                    <button onClick={() => setEquipPlantFilter([])} className={`chip${equipPlantFilter.length === 0 ? ' active' : ''}`}>All plants</button>
                    {plantsInFar.map(p => (
                      <button key={p.id} onClick={() => setEquipPlantFilter(f => f.includes(p.id) ? f.filter(x => x !== p.id) : [...f, p.id])} className={`chip${equipPlantFilter.includes(p.id) ? ' active' : ''}`}>{p.name}</button>
                    ))}
                    {equipPlantFilter.length > 1 && <span style={{ fontSize: 11, color: '#94A3B8', alignSelf: 'center' }}>combined</span>}
                  </div>
                )}
                <input value={equipSearch} onChange={e => setEquipSearch(e.target.value)} placeholder="Search equipment type or mark…" style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #E2E8F0', borderRadius: 8, padding: '7px 10px', fontSize: 13, marginBottom: 10, outline: 'none', background: '#fff' }} />
                <div className="overflow-x-auto scroll-x" style={{ maxHeight: 460 }}>
                  <table className="dt">
                    <thead>
                      <tr>
                        <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleEquipSort('type')}>Equipment Type{eqArrow('type')}</th>
                        <th className="num" style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleEquipSort('count')}>Count{eqArrow('count')}</th>
                        <th>Make</th><th>Model</th><th>Capacity</th><th>Year</th><th>Identification Marks</th><th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedGroups.length === 0 && <tr><td colSpan={8} className="text-center text-slate-400 py-6 text-sm">{assets.length === 0 ? t('far.noAssetsYet') : 'No equipment matches.'}</td></tr>}
                      {groupPg.pageRows.map(g => {
                        const open = expandedType === g.type;
                        const make = repVal(g.assets.map(a => a.make));
                        const model = repVal(g.assets.map(a => a.model));
                        const cap = repVal(g.assets.map(a => a.capacity));
                        const years = g.assets.map(a => a.year).filter((y): y is number => y != null);
                        const yr = years.length ? (Math.min(...years) === Math.max(...years) ? String(Math.min(...years)) : `${Math.min(...years)}–${Math.max(...years)}`) : '—';
                        const marks = g.assets.map(a => a.identification_mark).filter(Boolean);
                        return (
                          <React.Fragment key={g.type}>
                            <tr style={{ cursor: 'pointer' }} onClick={() => setExpandedType(open ? null : g.type)}>
                              <td className="font-semibold text-slate-700">{open ? '▾ ' : '▸ '}{g.type}</td>
                              <td className="num font-bold">{g.count}</td>
                              <td className="text-slate-500 text-xs">{make.text}{make.mixed ? ' …' : ''}</td>
                              <td className="text-slate-500 text-xs">{model.text}{model.mixed ? ' …' : ''}</td>
                              <td className="text-slate-500 text-xs">{cap.text}{cap.mixed ? ' …' : ''}</td>
                              <td className="text-slate-500 text-xs">{yr}</td>
                              <td className="text-slate-500 text-xs">{marks.slice(0, 3).join(', ')}{marks.length > 3 ? ` +${marks.length - 3} more` : ''}</td>
                              <td><span className="text-xs text-slate-400">{open ? '▴' : '▾'}</span></td>
                            </tr>
                            {open && (
                              <tr>
                                <td colSpan={8} style={{ background: '#FFFDF5', padding: 0 }}>
                                  <div className="overflow-x-auto scroll-x">
                                    <table className="dt" style={{ margin: 0 }}>
                                      <thead><tr><th>Mark</th><th>Make</th><th>Serial</th><th>Model</th><th className="num">Capacity</th><th className="num">Year</th><th className="num">Value</th>{plantsInFar.length > 1 && <th>Plant</th>}<th>Pic</th></tr></thead>
                                      <tbody>
                                        {g.assets.map(a => (
                                          <tr key={a.id}>
                                            <td className="font-semibold text-slate-700">{a.identification_mark || '—'}</td>
                                            <td className="text-slate-500 text-xs">{a.make || '—'}</td>
                                            <td className="text-slate-500 text-xs">{a.serial_no || '—'}</td>
                                            <td className="text-slate-500 text-xs">{a.model || '—'}</td>
                                            <td className="num text-xs">{a.capacity || '—'}</td>
                                            <td className="num text-xs">{a.year || '—'}</td>
                                            <td className="num text-xs font-semibold">{a.value ? `₹ ${Number(a.value).toLocaleString('en-IN')}` : '—'}</td>
                                            {plantsInFar.length > 1 && <td className="text-slate-500 text-xs">{a.plants?.name || '—'}</td>}
                                            <td><PicBadge has={!!a.photo_url} /></td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
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
                <TablePagination controls={groupPg.controls} />
              </div>
            )}
          </>
        )}
      </div>

      {/* Slide panel */}
      <SlidePanel open={open} onClose={handleClose} title={t('far.panelTitle')} subtitle="FAR · Purchase">
        <PanelField label={t('far.fldIdMark')}>
          <PanelInput placeholder="e.g. SCPL-PM-047, SHD-Compressor-3" value={form.mark} onChange={e => set('mark', e.target.value)} />
        </PanelField>

        <PanelRow>
          <PanelField label={t('far.fldModel')}>
            <PanelInput placeholder="e.g. Atlas Copco GA-22" value={form.model} onChange={e => set('model', e.target.value)} />
          </PanelField>
          <PanelField label={t('far.fldCapacity')}>
            <PanelInput placeholder="e.g. 5 MT, 22 kW" value={form.capacity} onChange={e => set('capacity', e.target.value)} />
          </PanelField>
        </PanelRow>

        <PanelRow>
          <PanelField label={t('far.fldOrigin')}>
            <PanelSelect value={form.origin} onChange={e => set('origin', e.target.value)}>
              <option>India</option>
              <option>Import</option>
            </PanelSelect>
          </PanelField>
          <PanelField label={t('far.fldYearOfPurchase')}>
            <PanelInput type="number" value={form.year} onChange={e => set('year', e.target.value)} />
          </PanelField>
        </PanelRow>

        <PanelRow>
          <PanelField label={t('far.fldTaxableValue')}>
            <PanelInput placeholder="e.g. ₹ 4,20,000" value={form.value} onChange={e => set('value', e.target.value)} />
          </PanelField>
          <PanelField label={t('far.fldInvoiceNo')}>
            <PanelInput placeholder="e.g. INV-2024-1234" value={form.invoice} onChange={e => set('invoice', e.target.value)} />
          </PanelField>
        </PanelRow>

        <PanelRow>
          <PanelField label={t('far.fldDateOfPurchase')}>
            <PanelInput type="date" value={form.purchaseDate} onChange={e => set('purchaseDate', e.target.value)} />
          </PanelField>
          <PanelField label={t('far.fldPlant')}>
            <PanelSelect value={form.plant} onChange={e => set('plant', e.target.value)}>
              {plantNames.map(p => <option key={p}>{p}</option>)}
            </PanelSelect>
          </PanelField>
        </PanelRow>

        <PanelField label={t('far.fldAccountHead')}>
          <PanelSelect value={form.account} onChange={e => set('account', e.target.value)}>
            {ACCOUNT_HEADS.map(a => <option key={a}>{a}</option>)}
          </PanelSelect>
        </PanelField>

        <PanelDivider />

        <OcrUpload
          label={t('far.ocrLabel')}
          hint={t('far.ocrHint')}
          fields={[
            { key: 'invoice',      label: t('far.ocrFldInvoiceNo'),     value: 'INV-2026-7234' },
            { key: 'model',        label: t('far.ocrFldModelMake'),     value: 'Atlas Copco GA18' },
            { key: 'capacity',     label: t('far.ocrFldCapacitySpecs'), value: '18 kW / 10 bar' },
            { key: 'value',        label: t('far.ocrFldTaxableValue'),  value: '3,85,000' },
            { key: 'purchaseDate', label: t('far.ocrFldInvoiceDate'),   value: new Date().toISOString().slice(0, 10) },
          ]}
          onExtracted={handleOcr}
        />

        <PanelFooter
          saved={saved}
          onCancel={handleClose}
          onSave={handleSave}
          saveLabel={t('far.registerAsset')}
          successLabel={t('far.assetRegistered')}
          successSub={t('far.assetRegisteredSub')}
          disabled={!form.mark.trim() || !form.model.trim()}
          requiredHint={t('far.requiredHint')}
        />
      </SlidePanel>

      {/* Maintenance entry drill-down */}
      <SlidePanel open={!!drillEntry} onClose={() => setDrillEntry(null)} title={drillEntry?.equipment || t('far.maintenance')} subtitle={t('far.maintenanceDetail')}>
        {drillEntry && (() => {
          const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '8px 0', borderBottom: '1px solid #F1F5F9' }}>
              <span style={{ fontSize: 12, color: '#94A3B8' }}>{k}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#0F172A', textAlign: 'right' }}>{v}</span>
            </div>
          );
          return (
            <div>
              <Row k={t('far.rowTicketNo')} v={drillEntry.id.slice(0, 8)} />
              <Row k={t('far.rowEquipment')} v={drillEntry.equipment} />
              <Row k={t('far.rowPlant')} v={drillEntry.plant} />
              <Row k={t('far.rowPartType')} v={drillEntry.part} />
              <Row k={t('far.rowStatus')} v={drillEntry.status.replace(/_/g, ' ')} />
              <Row k={t('far.rowFinancialYear')} v={drillEntry.fy} />
              <Row k={t('far.rowRaisedAt')} v={fmtDT(drillEntry.created_at)} />
              <Row k={t('far.rowClosedAt')} v={drillEntry.closed_at ? fmtDT(drillEntry.closed_at) : t('far.openDash')} />
              {drillEntry.procuredQty > 0 && <Row k="Qty procured" v={String(drillEntry.procuredQty)} />}
              {drillEntry.busyRef && <Row k={t('far.rowBusyRef')} v={drillEntry.busyRef} />}
              <div style={{ marginTop: 14, padding: '14px 16px', background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#15803D' }}>{drillEntry.procuredQty > 0 ? 'Procurement cost' : t('far.cost')}</span>
                <span style={{ fontSize: 18, fontWeight: 800, color: '#15803D' }}>{drillEntry.cost ? inr(drillEntry.cost) : t('far.inHouseNoPart')}</span>
              </div>
              {drillEntry.billUrl && (
                <a href={drillEntry.billUrl} target="_blank" rel="noreferrer" style={{ display: 'block', textAlign: 'center', marginTop: 10, fontSize: 12, color: '#2563EB' }}>View supplier bill ↗</a>
              )}
              <a href="/dashboard/purchase/maint" style={{ display: 'block', textAlign: 'center', marginTop: 14, fontSize: 12, color: '#2563EB' }}>{t('far.openInMaintenance')} →</a>
            </div>
          );
        })()}
      </SlidePanel>
    </>
  );
}
