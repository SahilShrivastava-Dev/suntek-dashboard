/**
 * Purchase-vs-consumption reconciliation, by factory.
 *
 * WHY THIS EXISTS
 * When several factories share a store, "who bought it" and "who used it" stop
 * being the same question. SCPL – Rehla may buy 100 gaskets on its own invoice
 * and use 10; SPPL(K) then draws 5 from the same shelf. Stock is held once —
 * that is the point of the shared store — but the money moved between two
 * different legal entities with different GSTINs.
 *
 * The system deliberately does NOT generate inter-company transfer documents
 * (that was a scoping decision, not an oversight). What it must do is surface
 * the gap, so the accountants have the numbers to settle it outside the system.
 * That is exactly what this table is: purchased vs consumed, per factory, with
 * the variance stated plainly.
 *
 * Reads `store_stock_events` — the single row written on every movement, which
 * carries BOTH `store_id` (where the stock physically moved) and
 * `requesting_plant_id` (who asked and who pays). One row, two questions.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../../lib/supabase';
import { usePlantScope } from '../../../contexts/PlantScopeContext';
import { SectionCard, ButtonV2, ThV2 as Th } from '../../../components/v2';
import { exportToCsv, type CsvColumn } from '../../../lib/utils/exportCsv';
import { useSortable } from '../../../components/ui/useSortable';

interface EventLite {
  store_id: string | null;
  plant_id: string | null;
  requesting_plant_id: string | null;
  event_type: string;
  qty_delta: number;
  created_at: string;
}
interface ReceiptLite { plant_id: string | null; store_id: string | null; amount: number | null; purchase_date: string | null }
interface PartCostLite { plant_id: string | null; total_price: number | null }

interface Row {
  plantId: string;
  factory: string;
  store: string;
  purchasedValue: number;   // ₹ on this factory's own purchase invoices
  procuredUnits: number;    // units added to the register by this factory
  consumedUnits: number;    // units issued against this factory's tickets
  partSpend: number;        // ₹ of maintenance parts charged to this factory
}

function inr(n: number): string { return `₹ ${Math.round(n).toLocaleString('en-IN')}`; }

const CSV_COLUMNS: CsvColumn[] = [
  { header: 'Factory', key: 'factory' },
  { header: 'Store', key: 'store' },
  { header: 'Purchased (INR)', key: 'purchasedValue' },
  { header: 'Units added', key: 'procuredUnits' },
  { header: 'Units consumed', key: 'consumedUnits' },
  { header: 'Maintenance part spend (INR)', key: 'partSpend' },
  { header: 'Net units (added - consumed)', key: 'netUnits' },
];

export function StoreReconciliation() {
  const { t } = useTranslation();
  const { plants, stores, storeIdFor, scopeQuery } = usePlantScope();
  const [events, setEvents] = useState<EventLite[]>([]);
  const [receipts, setReceipts] = useState<ReceiptLite[]>([]);
  const [partCosts, setPartCosts] = useState<PartCostLite[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    (async () => {
      setLoading(true);
      const [ev, rc, pc] = await Promise.all([
        scopeQuery(supabase.from('store_stock_events')
          .select('store_id, plant_id, requesting_plant_id, event_type, qty_delta, created_at'))
          .returns<EventLite[]>(),
        scopeQuery(supabase.from('stock_purchase_receipts')
          .select('plant_id, store_id, amount, purchase_date'))
          .returns<ReceiptLite[]>(),
        scopeQuery(supabase.from('maintenance_store_requests')
          .select('plant_id, total_price'))
          .returns<PartCostLite[]>(),
      ]);
      if (!alive) return;
      setEvents(ev.data ?? []);
      setReceipts(rc.data ?? []);
      setPartCosts(pc.data ?? []);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [open, scopeQuery]);

  const rows = useMemo<Row[]>(() => {
    const byPlant = new Map<string, Row>();
    const blank = (pid: string): Row => ({
      plantId: pid,
      factory: plants.find(p => p.id === pid)?.name ?? '—',
      store: stores.find(s => s.id === storeIdFor(pid))?.name ?? '—',
      purchasedValue: 0, procuredUnits: 0, consumedUnits: 0, partSpend: 0,
    });
    const get = (pid: string | null): Row | null => {
      if (!pid) return null;
      let r = byPlant.get(pid);
      if (!r) { r = blank(pid); byPlant.set(pid, r); }
      return r;
    };

    for (const e of events) {
      // requesting_plant_id is the cost owner. Fall back to plant_id for rows
      // recorded before that column existed.
      const r = get(e.requesting_plant_id ?? e.plant_id);
      if (!r) continue;
      const q = Number(e.qty_delta) || 0;
      if (e.event_type === 'issue') r.consumedUnits += Math.abs(q);
      else if (q > 0) r.procuredUnits += q;
    }
    for (const rc of receipts) {
      const r = get(rc.plant_id);
      if (r) r.purchasedValue += Number(rc.amount) || 0;
    }
    for (const pc of partCosts) {
      const r = get(pc.plant_id);
      if (r) r.partSpend += Number(pc.total_price) || 0;
    }
    return [...byPlant.values()].sort((a, b) => a.factory.localeCompare(b.factory));
  }, [events, receipts, partCosts, plants, stores, storeIdFor]);

  // Factories that share a store with someone else — the only ones where
  // "bought by" and "used by" can legitimately diverge.
  const sharedStoreIds = useMemo(() => {
    const count = new Map<string, number>();
    for (const p of plants) { const s = storeIdFor(p.id); if (s) count.set(s, (count.get(s) ?? 0) + 1); }
    return new Set([...count.entries()].filter(([, n]) => n > 1).map(([s]) => s));
  }, [plants, storeIdFor]);

  const sort = useSortable(rows, {
    factory: r => r.factory,
    purchased: r => r.purchasedValue,
    added: r => r.procuredUnits,
    consumed: r => r.consumedUnits,
    spend: r => r.partSpend,
  }, { key: 'factory', dir: 'asc' });

  const anyShared = rows.some(r => sharedStoreIds.has(storeIdFor(r.plantId) ?? ''));

  return (
    <SectionCard
      title={t('recon.title', 'Purchase vs consumption by factory')}
      subtitle={t('recon.subtitle', 'Who bought the stock, and who used it. On a shared store these are not the same factory.')}
      actions={
        <div className="flex gap-2">
          {open && rows.length > 0 && (
            <ButtonV2 variant="outline" onClick={() => exportToCsv(
              'purchase-vs-consumption', CSV_COLUMNS,
              rows.map(r => ({ ...r, netUnits: r.procuredUnits - r.consumedUnits })))}
            >⬇ {t('recon.export', 'Export')}</ButtonV2>
          )}
          <ButtonV2 variant="outline" onClick={() => setOpen(o => !o)}>
            {open ? t('recon.hide', 'Hide') : t('recon.show', 'Show')}
          </ButtonV2>
        </div>
      }
    >
      {!open ? null : loading ? (
        <div style={{ fontSize: 12.5, color: '#94A3B8', padding: 8 }}>{t('recon.loading', 'Loading…')}</div>
      ) : rows.length === 0 ? (
        <div style={{ fontSize: 12.5, color: '#94A3B8', padding: 8 }}>{t('recon.empty', 'No stock movements recorded yet.')}</div>
      ) : (
        <>
          {anyShared && (
            <div style={{ background: '#FFFDF5', border: '1px solid #FDE68A', borderRadius: 10, padding: 10, marginBottom: 10, fontSize: 11.5, color: '#92400E' }}>
              {t('recon.sharedNote', 'Some of these factories share one store, so stock bought by one can be consumed by another. Where those factories are separate legal entities, the difference below may need settling between them — the system records the movement and the attribution, it does not raise transfer documents.')}
            </div>
          )}
          <div className="overflow-x-auto scroll-x">
            <table className="dt2">
              <thead>
                <tr>
                  <Th sortKey="factory" s={sort}>{t('recon.thFactory', 'Factory')}</Th>
                  <th>{t('recon.thStore', 'Store')}</th>
                  <Th sortKey="purchased" s={sort} firstDir="desc" className="num">{t('recon.thPurchased', 'Purchased')}</Th>
                  <Th sortKey="added" s={sort} firstDir="desc" className="num">{t('recon.thAdded', 'Units added')}</Th>
                  <Th sortKey="consumed" s={sort} firstDir="desc" className="num">{t('recon.thConsumed', 'Units consumed')}</Th>
                  <Th sortKey="spend" s={sort} firstDir="desc" className="num">{t('recon.thSpend', 'Part spend')}</Th>
                  <th className="num">{t('recon.thNet', 'Net units')}</th>
                </tr>
              </thead>
              <tbody>
                {sort.sorted.map(r => {
                  const net = r.procuredUnits - r.consumedUnits;
                  const shared = sharedStoreIds.has(storeIdFor(r.plantId) ?? '');
                  return (
                    <tr key={r.plantId}>
                      <td style={{ fontWeight: 600 }}>{r.factory}</td>
                      <td className="text-slate-500 text-xs">
                        {r.store}{shared && <span style={{ color: '#B45309' }}> · {t('recon.shared', 'shared')}</span>}
                      </td>
                      <td className="num">{r.purchasedValue ? inr(r.purchasedValue) : '—'}</td>
                      <td className="num">{r.procuredUnits || '—'}</td>
                      <td className="num">{r.consumedUnits || '—'}</td>
                      <td className="num">{r.partSpend ? inr(r.partSpend) : '—'}</td>
                      <td className="num" style={{ color: net < 0 ? '#DC2626' : net > 0 ? '#16A34A' : '#94A3B8', fontWeight: 700 }}>
                        {net > 0 ? `+${net}` : net || '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 8 }}>
            {t('recon.netHelp', 'Net units = added − consumed. Positive means this factory has put more into the shared store than it has taken out; negative means it has drawn on stock someone else paid for.')}
          </div>
        </>
      )}
    </SectionCard>
  );
}
