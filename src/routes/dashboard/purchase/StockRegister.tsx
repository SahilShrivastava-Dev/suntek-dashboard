import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { insertRows } from '../../../lib/db';
import { useToast } from '../../../components/ui/toast';
import { SkeletonRows } from '../../../components/ui/states';
import { usePagination } from '../../../components/ui/usePagination';
import { TablePaginationV2 as TablePagination } from '../../../components/v2';
import { useSortable } from '../../../components/ui/useSortable';
import { ThV2 as Th } from '../../../components/v2';
import { usePlantScope } from '../../../contexts/PlantScopeContext';
import { useRoleContext } from '../../../contexts/RoleContext';
import { withEmbedFallback } from '../../../lib/scopedList';
import { uploadWorkflowFile } from '../../../lib/cloudinary';
import { parseStockFile, reconcile, type StockParseResult, type MonthParse, type MonthItem, type Anomaly } from '../../../lib/store/parseStockFile';
import { AddPurchaseModal } from './AddPurchaseModal';
import type { Database } from '../../../lib/database.types';

type StockItem = Database['public']['Tables']['store_items']['Row'];
type StockMonthRow = Database['public']['Tables']['store_stock_months']['Row'];
type Plant = { id: string; name: string };

interface StoreBreakdown { id: string; plantId: string | null; plant: string; onHand: number; issued: number; procured: number; raw: StockItem; }
interface MergedRow {
  key: string; itemName: string; equipment: string; model: string | null; unit: string;
  onHand: number; issued: number; procured: number; stores: StoreBreakdown[];
}

const CHUNK = 500;

/** Supabase/Postgrest errors are plain objects, not Error instances. */
function errMsg(e: unknown): string {
  if (!e) return 'Unknown error';
  if (typeof e === 'string') return e;
  if (e instanceof Error) return e.message;
  const o = e as { message?: string; details?: string; hint?: string; code?: string };
  return o.message || o.details || o.hint || (o.code ? `Error ${o.code}` : JSON.stringify(e));
}

function stockStatus(onHand: number): { label: string; bg: string; color: string } {
  if (onHand <= 0) return { label: 'Out', bg: '#FEE2E2', color: '#DC2626' };
  if (onHand <= 2) return { label: 'Low', bg: '#FEF3C7', color: '#D97706' };
  return { label: 'In stock', bg: '#DCFCE7', color: '#16A34A' };
}

const ANOM_META: Record<Anomaly['type'], { label: string; icon: string }> = {
  carry_forward: { label: 'Carry-forward drift', icon: '⚠' },
  intra_month:   { label: 'Sheet mismatch',     icon: '⚠' },
  negative:      { label: 'Negative stock',     icon: '🔴' },
  added:         { label: 'New item',           icon: '＋' },
  removed:       { label: 'Removed item',       icon: '－' },
};

/** Rebuild MonthParse[] from persisted snapshot rows (keyed by item name). */
function monthsFromRows(rows: StockMonthRow[]): MonthParse[] {
  const byPeriod = new Map<string, MonthItem[]>();
  for (const r of rows) {
    const list = byPeriod.get(r.period_month) ?? [];
    list.push({
      itemName: r.item_name, key: r.item_name.toLowerCase().replace(/\s+/g, ' ').trim(),
      unit: r.unit || '', equipment: '', model: null,
      opening: Number(r.opening), purchaseOpening: Number(r.purchase_opening),
      purchased: Number(r.purchased), used: Number(r.used), closing: Number(r.computed_closing),
    });
    byPeriod.set(r.period_month, list);
  }
  return [...byPeriod.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([pk, items]) => ({ periodKey: pk.slice(0, 7), periodMonth: pk, label: pk, items, hasSales: true, hasPurchase: true }));
}

const inputStyle: React.CSSProperties = {
  border: '1px solid #E2E8F0', borderRadius: 8, padding: '7px 10px', fontSize: 13, fontFamily: 'inherit', outline: 'none',
};

export function StockRegister() {
  const toast = useToast();
  const { scopeQuery, allowedPlants } = usePlantScope();
  const { activeProfile } = useRoleContext();

  const [items, setItems] = useState<(StockItem & { plants?: { name: string | null } | null })[]>([]);
  const [months, setMonths] = useState<StockMonthRow[]>([]);
  const [plants, setPlants] = useState<Plant[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showAnoms, setShowAnoms] = useState(false);
  const [collapsed, setCollapsed] = useState(true);        // the 400+ row table is hidden until asked
  const [plantFilter, setPlantFilter] = useState<string[]>([]); // empty = all plants (merged)
  const [showPurchase, setShowPurchase] = useState(false);

  // Import flow
  const [stage, setStage] = useState<'idle' | 'uploading' | 'parsing' | 'review' | 'importing' | 'done' | 'error'>('idle');
  const [err, setErr] = useState<string | null>(null);
  const [parseResult, setParseResult] = useState<StockParseResult | null>(null);
  const [fileName, setFileName] = useState('');
  const [cloudUrl, setCloudUrl] = useState<string | null>(null);
  const [importPlant, setImportPlant] = useState('');
  const [importAnoms, setImportAnoms] = useState<Anomaly[]>([]);
  const [importedCount, setImportedCount] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  // Manual edit modal
  const [editItem, setEditItem] = useState<StockItem | null>(null);
  const [editForm, setEditForm] = useState({ name: '', onHand: '', reason: '' });

  async function load() {
    try {
      const { data: pl } = await supabase.from('plants').select('id, name').returns<Plant[]>();
      setPlants(pl || []);
      const { data: si } = await withEmbedFallback(
        scopeQuery(supabase.from('store_items').select('*, plants(name)')).order('item_name').returns<(StockItem & { plants?: { name: string | null } | null })[]>(),
        () => scopeQuery(supabase.from('store_items').select('*')).order('item_name').returns<(StockItem & { plants?: { name: string | null } | null })[]>(),
        'StockRegister.items',
      );
      setItems(si || []);
      const { data: sm } = await scopeQuery(supabase.from('store_stock_months').select('*')).returns<StockMonthRow[]>();
      setMonths(sm || []);
    } catch (e) {
      console.error('[StockRegister] load failed', e);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [scopeQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  const plantOptions = allowedPlants.length > 0 ? allowedPlants as Plant[] : plants;
  const plantName = (id: string | null) => plants.find(p => p.id === id)?.name || '—';

  // Live anomalies from persisted snapshots (latest two months). Respects the active
  // store filter so the count always matches the visible table (fixes the count being
  // stuck at the all-plants total when a single store is selected). Each plant is
  // reconciled independently — same-named items in different plants are distinct — then
  // the per-plant anomalies are combined.
  const anomalies = useMemo(() => {
    const scoped = plantFilter.length ? months.filter(m => m.plant_id && plantFilter.includes(m.plant_id)) : months;
    if (!scoped.length) return [];
    const byPlant = new Map<string, StockMonthRow[]>();
    for (const r of scoped) {
      const k = r.plant_id || '—';
      const arr = byPlant.get(k);
      if (arr) arr.push(r); else byPlant.set(k, [r]);
    }
    const out: (Anomaly & { plant?: string })[] = [];
    for (const [pid, rows] of byPlant.entries()) {
      const ms = monthsFromRows(rows);
      if (!ms.length) continue;
      const plant = pid === '—' ? undefined : plantName(pid);
      for (const a of reconcile(ms.length >= 2 ? ms[ms.length - 2] : null, ms[ms.length - 1])) {
        out.push({ ...a, plant });
      }
    }
    return out;
  }, [months, plantFilter, plants]); // eslint-disable-line react-hooks/exhaustive-deps

  const latestUpload = useMemo(() => {
    if (!months.length) return null;
    return months.reduce((mx, m) => (m.period_month > mx ? m.period_month : mx), months[0].period_month);
  }, [months]);

  // Plants that actually have stock rows → the filter chips.
  const plantsInData = useMemo(() => {
    const seen = new Map<string, string>();
    for (const it of items) if (it.plant_id) seen.set(it.plant_id, it.plants?.name || plantName(it.plant_id));
    return [...seen.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [items, plants]); // eslint-disable-line react-hooks/exhaustive-deps

  function togglePlant(id: string) { setPlantFilter(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]); }

  // Merge identical items across the selected plants (sum on-hand + issued),
  // so combining SPPL + Rehla shows 58, not two 29 rows.
  const merged = useMemo<MergedRow[]>(() => {
    const q = search.trim().toLowerCase();
    const map = new Map<string, MergedRow>();
    for (const it of items) {
      if (plantFilter.length && !(it.plant_id && plantFilter.includes(it.plant_id))) continue;
      if (q && !(it.item_name.toLowerCase().includes(q) || (it.equipment || '').toLowerCase().includes(q) || (it.model || '').toLowerCase().includes(q))) continue;
      const key = it.item_name.toLowerCase().replace(/\s+/g, ' ').replace(/[^a-z0-9 ]/g, '').trim();
      const store = { id: it.id, plantId: it.plant_id, plant: it.plants?.name || plantName(it.plant_id), onHand: Number(it.on_hand), issued: Number(it.issued_qty), procured: Number(it.ticket_procured_qty || 0), raw: it };
      const ex = map.get(key);
      if (ex) { ex.onHand += store.onHand; ex.issued += store.issued; ex.procured += store.procured; ex.stores.push(store); }
      else map.set(key, { key, itemName: it.item_name, equipment: it.equipment || '', model: it.model, unit: it.unit || '', onHand: store.onHand, issued: store.issued, procured: store.procured, stores: [store] });
    }
    return [...map.values()].sort((a, b) => a.itemName.localeCompare(b.itemName));
  }, [items, plantFilter, search, plants]); // eslint-disable-line react-hooks/exhaustive-deps

  const summary = useMemo(() => {
    let inStock = 0, low = 0, out = 0;
    for (const m of merged) { const s = stockStatus(m.onHand); if (s.label === 'Out') out++; else if (s.label === 'Low') low++; else inStock++; }
    return { total: merged.length, inStock, low, out };
  }, [merged]);

  // Column sort — click a header to sort by it (toggles asc/desc).
  const mergedSort = useSortable(merged, {
    item: r => r.itemName,
    onHand: r => r.onHand,
    issued: r => r.issued,
    procured: r => r.procured,
    status: r => (r.onHand <= 0 ? 0 : r.onHand <= 2 ? 1 : 2),
  }, { key: 'item', dir: 'asc' });

  // Paginate the register — it can hold hundreds of items per plant.
  const { pageRows, controls } = usePagination(mergedSort.sorted, { resetKey: `${search}|${plantFilter.join(',')}|${mergedSort.sort.key}|${mergedSort.sort.dir}` });

  // ── Import ──────────────────────────────────────────────────────────────────
  function defaultPlant(): string { return plantOptions[0]?.id || ''; }

  async function handleFile(file: File) {
    setErr(null); setFileName(file.name); setStage('uploading'); setCloudUrl(null); setParseResult(null);
    try {
      try {
        const up = await uploadWorkflowFile(file, { workflow: 'store-req', subfolder: 'stock', kind: 'stock', creator: activeProfile.name });
        setCloudUrl(up.secure_url);
      } catch { /* cloud archive is best-effort */ }
      setStage('parsing');
      if (!/\.(xlsx|xls|csv)$/i.test(file.name)) throw new Error('Please upload an .xlsx / .xls spreadsheet.');
      const res = await parseStockFile(file);
      if (!res.latest || !res.months.length) throw new Error('No "Sales <Month>" / "Purchase <Month>" sheets found in this file.');
      setParseResult(res);
      const n = res.months.length;
      setImportAnoms(reconcile(n >= 2 ? res.months[n - 2] : null, res.months[n - 1]));
      setImportPlant(defaultPlant());
      setStage('review');
    } catch (e) {
      setErr(errMsg(e)); setStage('error');
    }
  }

  async function confirmImport() {
    if (!parseResult?.latest) return;
    setStage('importing');
    try {
      const res = parseResult;
      const latest = res.latest!;
      const plantId = importPlant || null;
      const monthDates = res.months.map(m => m.periodMonth);

      // 1) Upload manifest (latest month; re-upload replaces).
      const { data: up, error: upErr } = await (supabase.from('store_stock_uploads') as any).upsert({
        plant_id: plantId, period_month: latest.periodMonth, file_name: fileName, file_url: cloudUrl,
        uploaded_by_name: activeProfile.name, row_count: res.totalItems, sheet_count: res.sheetCount,
      }, { onConflict: 'plant_id,period_month' }).select('id').single();
      if (upErr) throw upErr;
      const uploadId = up?.id ?? null;

      // 2) Replace this plant's month snapshots (the file is the source of truth).
      await supabase.from('store_stock_months').delete().eq('plant_id', plantId as string).in('period_month', monthDates);
      const monthRows = res.months.flatMap(m => m.items.map(it => ({
        upload_id: uploadId, plant_id: plantId, period_month: m.periodMonth, item_name: it.itemName, unit: it.unit,
        opening: it.opening, purchase_opening: it.purchaseOpening, purchased: it.purchased, used: it.used, computed_closing: it.closing,
      })));
      for (let i = 0; i < monthRows.length; i += CHUNK) {
        const { error } = await insertRows('store_stock_months', monthRows.slice(i, i + CHUNK));
        if (error) throw error;
      }

      // 3) Seed the living register from the latest month's computed closing.
      const nowIso = new Date().toISOString();
      const itemRows = latest.items.map(it => ({
        plant_id: plantId, item_name: it.itemName, unit: it.unit, equipment: it.equipment, model: it.model,
        baseline_qty: it.closing, baseline_month: latest.periodMonth, procured_qty: 0, issued_qty: 0, manual_delta: 0,
        ticket_procured_qty: 0, on_hand: it.closing, updated_at: nowIso,
      }));
      for (let i = 0; i < itemRows.length; i += CHUNK) {
        const { error } = await (supabase.from('store_items') as any).upsert(itemRows.slice(i, i + CHUNK), { onConflict: 'plant_id,item_name' });
        if (error) throw error;
      }

      setImportedCount(latest.items.length);
      setStage('done');
      await load();
    } catch (e) {
      setErr(errMsg(e)); setStage('error');
    }
  }

  function resetImport() { setStage('idle'); setParseResult(null); setErr(null); setCloudUrl(null); setImportAnoms([]); }

  // ── Manual edit (requires justification, logged to Activity Log) ─────────────
  function openEdit(it: StockItem) { setEditItem(it); setEditForm({ name: it.item_name, onHand: String(it.on_hand), reason: '' }); }

  async function saveEdit() {
    if (!editItem) return;
    const reason = editForm.reason.trim();
    if (!reason) { toast.error('A justification is required for any stock edit.'); return; }
    const oldOnHand = Number(editItem.on_hand);
    const newOnHand = parseFloat(editForm.onHand);
    const newName = editForm.name.trim() || editItem.item_name;
    const nameChanged = newName !== editItem.item_name;
    const qtyChanged = !isNaN(newOnHand) && newOnHand !== oldOnHand;
    if (!nameChanged && !qtyChanged) { toast.error('Nothing changed.'); return; }
    if (qtyChanged && newOnHand < 0) { toast.error('On-hand cannot be negative.'); return; }
    const delta = qtyChanged ? newOnHand - oldOnHand : 0;
    try {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (nameChanged) patch.item_name = newName;
      if (qtyChanged) { patch.on_hand = newOnHand; patch.manual_delta = Number(editItem.manual_delta) + delta; }
      const { error } = await (supabase.from('store_items') as any).update(patch).eq('id', editItem.id);
      if (error) throw error;
      await insertRows('store_stock_events', {
        item_id: editItem.id, plant_id: editItem.plant_id, event_type: qtyChanged ? 'manual_edit' : 'rename',
        qty_delta: delta, on_hand_after: qtyChanged ? newOnHand : oldOnHand, justification: reason,
        actor_name: activeProfile.name,
      });
      await insertRows('activity_logs', {
        equipment: `Stock: ${newName}`, type: 'stock_edit', date: new Date().toISOString().slice(0, 10),
        done_by: activeProfile.name, plant_id: editItem.plant_id,
        note: `${qtyChanged ? `Qty ${oldOnHand} → ${newOnHand} (${delta > 0 ? '+' : ''}${delta}). ` : ''}${nameChanged ? `Renamed from "${editItem.item_name}". ` : ''}${reason}`,
      });
      setEditItem(null);
      toast.success('Stock updated and logged to the Activity Log.');
      await load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  }

  const busy = stage === 'uploading' || stage === 'parsing';

  const multiStore = plantFilter.length !== 1 && plantsInData.length > 1;

  return (
    <div className="card2 p-6 mb-5">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
        <div>
          <div className="text-base font-bold font-heading">Stock register</div>
          <div className="text-xs text-slate-500">
            On-hand seeded from the monthly Store Keeping file, adjusted live as parts are issued.
            {latestUpload ? ` · Latest month: ${latestUpload.slice(0, 7)}` : ''}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {items.length > 0 && (
            <button onClick={() => setShowPurchase(true)} className="pill px-4 py-2 font-semibold text-sm" style={{ border: '1px solid #E2E8F0', background: '#fff', color: '#334155', cursor: 'pointer' }}>＋ Add Purchase</button>
          )}
          <button onClick={() => fileRef.current?.click()} className="btn-accent rounded-[10px] px-4 py-2 font-semibold text-sm">↑ Upload Excel</button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }} />
        </div>
      </div>

      {loading ? <SkeletonRows rows={4} /> : items.length === 0 ? (
        <div className="text-center text-slate-400 py-8 text-sm">
          No stock file uploaded yet.<br />Upload the monthly <strong>Store Keeping</strong> Excel to seed the register.
        </div>
      ) : (
        <>
          {/* Summary strip + expand toggle (the big table stays collapsed) */}
          <div className="flex items-center justify-between flex-wrap gap-2" style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 12, padding: '10px 14px' }}>
            <div style={{ fontSize: 13, color: '#334155' }}>
              <strong>{summary.total}</strong> item{summary.total === 1 ? '' : 's'}
              {plantsInData.length > 1 && <span className="text-slate-500"> · {plantFilter.length ? `${plantFilter.length} of ${plantsInData.length} plants` : `${plantsInData.length} plants`}</span>}
              <span className="text-slate-400"> · </span>
              <span style={{ color: '#16A34A' }}>{summary.inStock} in stock</span>
              <span className="text-slate-400"> · </span>
              <span style={{ color: '#D97706' }}>{summary.low} low</span>
              <span className="text-slate-400"> · </span>
              <span style={{ color: '#DC2626' }}>{summary.out} out</span>
            </div>
            <div className="flex items-center gap-2">
              {anomalies.length > 0 && (
                <button onClick={() => { setCollapsed(false); setShowAnoms(true); }} style={{ fontSize: 12, fontWeight: 700, color: '#B45309', background: '#FFFBEB', border: '1px solid #FED7AA', borderRadius: 8, padding: '5px 10px', cursor: 'pointer', fontFamily: 'inherit' }}>⚠ {anomalies.length} anomalies</button>
              )}
              <button onClick={() => setCollapsed(c => !c)} className="text-sm font-semibold" style={{ color: '#F47651', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
                {collapsed ? 'Show register ▾' : 'Hide register ▴'}
              </button>
            </div>
          </div>

          {!collapsed && (
            <div style={{ marginTop: 14 }}>
              {/* Plant filter chips */}
              {plantsInData.length > 1 && (
                <div className="flex gap-2 mb-3 flex-wrap">
                  <button onClick={() => setPlantFilter([])} className={`chip${plantFilter.length === 0 ? ' active' : ''}`}>All stores</button>
                  {plantsInData.map(p => (
                    <button key={p.id} onClick={() => togglePlant(p.id)} className={`chip${plantFilter.includes(p.id) ? ' active' : ''}`}>{p.name}</button>
                  ))}
                  {plantFilter.length > 1 && <span style={{ fontSize: 11, color: '#94A3B8', alignSelf: 'center' }}>combined · identical items summed</span>}
                </div>
              )}

              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search item / equipment…" style={{ ...inputStyle, width: '100%', marginBottom: 12 }} />

              {/* Anomalies */}
              {anomalies.length > 0 && (
                <div style={{ border: '1px solid #FED7AA', background: '#FFFBEB', borderRadius: 12, padding: 12, marginBottom: 14 }}>
                  <button onClick={() => setShowAnoms(v => !v)} style={{ display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#B45309' }}>⚠ {anomalies.length} anomal{anomalies.length === 1 ? 'y' : 'ies'} in the latest file vs the prior month</span>
                    <span style={{ fontSize: 12, color: '#B45309' }}>{showAnoms ? 'Hide' : 'Show'}</span>
                  </button>
                  {showAnoms && (
                    <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 260, overflowY: 'auto' }}>
                      {anomalies.map((a, i) => (
                        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12, background: '#fff', border: '1px solid #FDE68A', borderRadius: 8, padding: '7px 10px' }}>
                          <span title={ANOM_META[a.type].label}>{ANOM_META[a.type].icon}</span>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 600, color: '#334155' }}>
                              {a.item}
                              {a.plant && <span style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 700, color: '#B45309', background: '#FEF3C7', borderRadius: 6, padding: '1px 6px' }}>{a.plant}</span>}
                            </div>
                            <div style={{ color: '#64748B' }}>{a.detail}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="overflow-x-auto scroll-x">
                <table className="dt2">
                  <thead>
                    <tr>
                      <Th sortKey="item" s={mergedSort}>Item</Th><th>Equipment</th>{multiStore && <th>Stores</th>}<th>Unit</th>
                      <Th sortKey="onHand" s={mergedSort} firstDir="desc" className="num">On-hand</Th>
                      <Th sortKey="issued" s={mergedSort} firstDir="desc" className="num">Issued</Th>
                      <Th sortKey="procured" s={mergedSort} firstDir="desc" className="num">Procured</Th>
                      <Th sortKey="status" s={mergedSort} firstDir="desc">Status</Th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {mergedSort.sorted.length === 0 && <tr><td colSpan={multiStore ? 9 : 8} className="text-center text-slate-400 py-6 text-sm">No items match.</td></tr>}
                    {pageRows.map(m => {
                      const st = stockStatus(m.onHand);
                      const isOpen = expanded === m.key;
                      const single = m.stores.length === 1;
                      return (
                        <React.Fragment key={m.key}>
                          <tr style={{ cursor: 'pointer' }} onClick={() => setExpanded(isOpen ? null : m.key)}>
                            <td className="font-semibold text-slate-700">{m.itemName}</td>
                            <td className="text-slate-500 text-xs">{m.equipment}{m.model ? ` · ${m.model}` : ''}</td>
                            {multiStore && <td className="text-slate-500 text-xs">{single ? m.stores[0].plant : `${m.stores.length} stores`}</td>}
                            <td className="text-slate-500 text-xs">{m.unit}</td>
                            <td className="num font-bold" style={{ color: st.color }}>{m.onHand}</td>
                            <td className="num" style={{ color: m.issued > 0 ? '#2563EB' : '#CBD5E1' }}>{m.issued || '—'}</td>
                            <td className="num" style={{ color: m.procured > 0 ? '#7C3AED' : '#CBD5E1' }}>{m.procured || '—'}</td>
                            <td><span className="badge" style={{ background: st.bg, color: st.color, fontWeight: 700 }}>{st.label}</span></td>
                            <td>{single ? <button onClick={e => { e.stopPropagation(); openEdit(m.stores[0].raw); }} className="text-xs" style={{ color: '#2563EB', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>Edit</button> : <span className="text-xs text-slate-400">▾</span>}</td>
                          </tr>
                          {isOpen && (
                            <tr>
                              <td colSpan={multiStore ? 9 : 8} style={{ background: '#F8FAFC', padding: '8px 12px' }}>
                                {m.stores.map(s => (
                                  <div key={s.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, fontSize: 11.5, color: '#64748B', padding: '3px 0' }}>
                                    <strong style={{ color: '#334155', minWidth: 70 }}>{s.plant}</strong>
                                    <span>On-hand: <strong>{s.onHand}</strong></span>
                                    <span>Baseline ({s.raw.baseline_month?.slice(0, 7) || '—'}): <strong>{Number(s.raw.baseline_qty)}</strong></span>
                                    <span>− Issued from store: <strong>{Number(s.raw.issued_qty)}</strong></span>
                                    <span style={{ color: '#7C3AED' }}>Procured for tickets: <strong>{s.procured}</strong></span>
                                    {Number(s.raw.procured_qty) > 0 && <span>+ Restocked: <strong>{Number(s.raw.procured_qty)}</strong></span>}
                                    <span>Manual: <strong>{Number(s.raw.manual_delta) > 0 ? '+' : ''}{Number(s.raw.manual_delta)}</strong></span>
                                    <button onClick={e => { e.stopPropagation(); openEdit(s.raw); }} style={{ color: '#2563EB', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 11.5 }}>Edit</button>
                                  </div>
                                ))}
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <TablePagination controls={controls} />
            </div>
          )}
        </>
      )}

      {/* ── Add purchase modal ────────────────────────────────────────────────── */}
      <AddPurchaseModal open={showPurchase} onClose={() => setShowPurchase(false)} onApplied={load} />

      {/* ── Import modal ──────────────────────────────────────────────────────── */}
      {stage !== 'idle' && (
        <div style={overlay} onClick={() => { if (!busy && stage !== 'importing') resetImport(); }}>
          <div style={modal} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Upload stock file</div>
            <div style={{ fontSize: 12, color: '#94A3B8', marginBottom: 14 }}>{fileName}</div>

            {busy && <div style={{ fontSize: 13, color: '#475569', padding: '18px 0' }}>{stage === 'uploading' ? 'Archiving file to cloud…' : 'Reading Sales & Purchase sheets…'}</div>}

            {stage === 'error' && (
              <div style={{ fontSize: 13, color: '#DC2626', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: 10, marginBottom: 12 }}>{err}</div>
            )}

            {stage === 'review' && parseResult && (
              <div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
                  <Stat label="Months found" value={parseResult.months.length} />
                  <Stat label="Latest month" value={parseResult.latest!.periodKey} />
                  <Stat label="Items (latest)" value={parseResult.totalItems} />
                </div>
                <div style={{ fontSize: 12, color: '#475569', marginBottom: 10 }}>
                  Register on-hand will be seeded from <strong>{parseResult.latest!.label}</strong>'s computed closing
                  (opening + purchased − used). Existing snapshots for these months will be replaced.
                </div>
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', marginBottom: 4 }}>Plant this file belongs to</div>
                  <select value={importPlant} onChange={e => setImportPlant(e.target.value)} style={{ ...inputStyle, width: '100%' }}>
                    {plantOptions.length === 0 && <option value="">(no plant)</option>}
                    {plantOptions.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                {importAnoms.length > 0 && (
                  <div style={{ fontSize: 12, color: '#B45309', background: '#FFFBEB', border: '1px solid #FED7AA', borderRadius: 8, padding: 10, marginBottom: 12 }}>
                    ⚠ {importAnoms.length} anomal{importAnoms.length === 1 ? 'y' : 'ies'} detected between the last two months in this file — you'll be able to review and fix them in the register after import.
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={resetImport} style={btnGhost}>Cancel</button>
                  <button onClick={confirmImport} style={{ ...btnPrimary, flex: 1 }}>Import {parseResult.totalItems} items</button>
                </div>
              </div>
            )}

            {stage === 'importing' && <div style={{ fontSize: 13, color: '#475569', padding: '18px 0' }}>Writing register…</div>}

            {stage === 'done' && (
              <div>
                <div style={{ fontSize: 13, color: '#16A34A', marginBottom: 14 }}>✓ Imported {importedCount} items into the register.</div>
                <button onClick={resetImport} style={{ ...btnPrimary, width: '100%' }}>Done</button>
              </div>
            )}

            {stage === 'error' && (
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={resetImport} style={{ ...btnGhost, flex: 1 }}>Close</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Manual edit modal ─────────────────────────────────────────────────── */}
      {editItem && (
        <div style={overlay} onClick={() => setEditItem(null)}>
          <div style={modal} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Edit stock item</div>
            <div style={{ marginBottom: 10 }}>
              <div style={label}>Item name</div>
              <input value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} style={{ ...inputStyle, width: '100%' }} />
            </div>
            <div style={{ marginBottom: 10 }}>
              <div style={label}>On-hand quantity</div>
              <input type="number" value={editForm.onHand} onChange={e => setEditForm(f => ({ ...f, onHand: e.target.value }))} style={{ ...inputStyle, width: '100%' }} />
            </div>
            <div style={{ marginBottom: 14 }}>
              <div style={label}>Justification (required)</div>
              <div style={{ fontSize: 11, color: '#94A3B8', marginBottom: 4 }}>Why is this changing? e.g. "physically counted", a ticket #, or a description.</div>
              <textarea value={editForm.reason} onChange={e => setEditForm(f => ({ ...f, reason: e.target.value }))} rows={3} style={{ ...inputStyle, width: '100%', resize: 'vertical' }} placeholder="e.g. Ticket #4b7bd471 — 4 issued to technician manually while system was down." />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setEditItem(null)} style={btnGhost}>Cancel</button>
              <button onClick={saveEdit} style={{ ...btnPrimary, flex: 1, opacity: editForm.reason.trim() ? 1 : 0.5 }} disabled={!editForm.reason.trim()}>Save & log</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ flex: 1, minWidth: 90, background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 10, padding: '8px 12px' }}>
      <div style={{ fontSize: 10.5, color: '#94A3B8', textTransform: 'uppercase', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: '#334155', marginTop: 2 }}>{value}</div>
    </div>
  );
}

const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 };
const modal: React.CSSProperties = { background: '#fff', borderRadius: 16, padding: 22, width: 'min(460px, 100%)', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' };
const label: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', marginBottom: 4 };
const btnPrimary: React.CSSProperties = { padding: '10px 16px', borderRadius: 10, border: 'none', background: '#F47651', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' };
const btnGhost: React.CSSProperties = { padding: '10px 16px', borderRadius: 10, border: '1px solid #E2E8F0', background: '#fff', color: '#475569', fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' };
