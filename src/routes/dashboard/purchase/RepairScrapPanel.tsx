import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Wrench, Trash2, PackageCheck } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { callRpc } from '../../../lib/db';
import { usePlantScope } from '../../../contexts/PlantScopeContext';
import { useRoleContext } from '../../../contexts/RoleContext';
import { profileHasCapability } from '../../../lib/profiles';
import { withEmbedFallback } from '../../../lib/scopedList';
import { SkeletonRows, EmptyState } from '../../../components/ui/states';
import { ImageLightbox, type LightboxImage } from '../../../components/ui/ImageLightbox';
import { usePagination } from '../../../components/ui/usePagination';
import { TablePaginationV2 as TablePagination } from '../../../components/v2';
import { useSortable } from '../../../components/ui/useSortable';
import { ThV2 as Th, StatusPill } from '../../../components/v2';
import { TableSearch, useTextFilter } from '../../../components/ui/TableSearch';
import { useToast } from '../../../components/ui/toast';
import { RepairReturnModal } from './RepairReturnModal';
import { repairPending } from '../../../lib/store/repairReturn';
import type { Database } from '../../../lib/database.types';

type TicketRow = Database['public']['Tables']['maintenance_tickets']['Row'] & { plants?: { name: string | null } | null };
type ReceiptRow = Database['public']['Tables']['repair_return_receipts']['Row'] & { plants?: { name: string | null } | null };
type AllocRow = Database['public']['Tables']['repair_return_allocations']['Row'];

const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

/** Return progress of a repair ticket: pending / partial / returned. */
function returnState(t: TicketRow): 'pending' | 'partial' | 'returned' {
  const ret = Number(t.repair_returned_qty ?? 0);
  if (ret <= 0) return 'pending';
  return repairPending(t) > 0 ? 'partial' : 'returned';
}

/**
 * Repair & scrap tracking — where a maintenance job's defective part ended up.
 * Sourced from maintenance_tickets.defective_part_decision ('repair' | 'scrap').
 * Repair rows carry sent/returned/pending quantities and (for authorized users)
 * a Return-to-Inventory action: returned units land in the register's separate
 * repaired-stock bucket via the apply_repair_return RPC. Scrap rows never get
 * the action — scrapped parts cannot re-enter stock.
 */
export function RepairScrapPanel() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const { scopeQuery } = usePlantScope();
  const { activeProfile } = useRoleContext();
  const [rows, setRows] = useState<TicketRow[]>([]);
  const [receipts, setReceipts] = useState<ReceiptRow[]>([]);
  const [allocs, setAllocs] = useState<AllocRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [lightbox, setLightbox] = useState<LightboxImage[] | null>(null);
  const [returnTicket, setReturnTicket] = useState<TicketRow | null>(null);

  const canReturn = profileHasCapability(activeProfile, 'return_repairs');
  const canReverse = profileHasCapability(activeProfile, 'reverse_repair_return');

  const load = useCallback(async () => {
    const { data } = await withEmbedFallback(
      scopeQuery(supabase.from('maintenance_tickets').select('*, plants(name)'), { unitCol: 'unit_id' })
        .not('defective_part_decision', 'is', null).order('closed_at', { ascending: false }).returns<TicketRow[]>(),
      () => scopeQuery(supabase.from('maintenance_tickets').select('*'), { unitCol: 'unit_id' })
        .not('defective_part_decision', 'is', null).order('closed_at', { ascending: false }).returns<TicketRow[]>(),
      'RepairScrap.tickets',
    );
    setRows(data || []);
    // Return history (best-effort — tables arrive with migration 55).
    try {
      const { data: rc, error: rcErr } = await withEmbedFallback(
        scopeQuery(supabase.from('repair_return_receipts').select('*, plants(name)'))
          .order('created_at', { ascending: false }).limit(200).returns<ReceiptRow[]>(),
        () => scopeQuery(supabase.from('repair_return_receipts').select('*'))
          .order('created_at', { ascending: false }).limit(200).returns<ReceiptRow[]>(),
        'RepairScrap.receipts',
      );
      const receiptRows = rcErr ? [] : (rc || []);
      setReceipts(receiptRows);
      if (receiptRows.length) {
        const { data: al } = await supabase.from('repair_return_allocations')
          .select('*').in('receipt_id', receiptRows.map(r => r.id)).returns<AllocRow[]>();
        setAllocs(al || []);
      } else setAllocs([]);
    } catch { setReceipts([]); setAllocs([]); }
    setLoading(false);
  }, [scopeQuery]);

  useEffect(() => { load(); }, [load]);

  const filtered = useTextFilter(rows, search, r => [r.equipment, r.plants?.name, r.id.slice(0, 8), r.assigned_to]);
  const repair = useMemo(() => filtered.filter(r => r.defective_part_decision === 'repair'), [filtered]);
  const scrap = useMemo(() => filtered.filter(r => r.defective_part_decision === 'scrap'), [filtered]);

  if (loading) return <div className="card2 p-6" style={{ marginTop: 20 }}><SkeletonRows rows={4} /></div>;
  if (rows.length === 0) return null; // nothing sent to repair/scrap yet → hide the panel entirely

  return (
    <div className="card2 p-6" style={{ marginTop: 20, position: 'relative' }}>
      <div className="text-base font-bold font-heading">{t('repairScrap.title', 'Repair & scrap tracking')}</div>
      <div className="text-xs text-slate-500 mb-3">{t('repairScrap.subtitle', 'Assets sent for repair or scrapped at the end of a maintenance job — with photo proof and a link to the ticket.')}</div>
      <TableSearch value={search} onChange={setSearch} placeholder={t('repairScrap.searchPh', 'Search equipment, plant, ticket…')} />
      <RepairScrapTable variant="repair" title={t('repairScrap.repairItems', 'Repair items')} tone="amber" icon={<Wrench size={14} />} rows={repair}
        canReturn={canReturn} onReturn={setReturnTicket}
        onOpenTicket={id => navigate(`/dashboard/purchase/maint?ticket=${id}`)} onPhoto={setLightbox} />
      <div style={{ height: 20 }} />
      <RepairScrapTable variant="scrap" title={t('repairScrap.scrapItems', 'Scrap items')} tone="red" icon={<Trash2 size={14} />} rows={scrap}
        canReturn={false} onReturn={() => {}}
        onOpenTicket={id => navigate(`/dashboard/purchase/maint?ticket=${id}`)} onPhoto={setLightbox} />
      {receipts.length > 0 && (
        <>
          <div style={{ height: 20 }} />
          <ReturnHistory receipts={receipts} allocs={allocs} canReverse={canReverse}
            onReversed={() => { load(); }} onOpenTicket={id => navigate(`/dashboard/purchase/maint?ticket=${id}`)}
            toastError={m => toast.error(m)} toastOk={m => toast.success(m)} />
        </>
      )}
      <ImageLightbox images={lightbox || []} open={!!lightbox} onClose={() => setLightbox(null)} />
      <RepairReturnModal open={!!returnTicket} focusTicket={returnTicket} tickets={rows}
        onClose={() => setReturnTicket(null)} onSaved={() => { load(); toast.success(t('repairReturn.saved', 'Repaired items added to inventory.')); }} />
    </div>
  );
}

function RepairScrapTable({ variant, title, tone, icon, rows, canReturn, onReturn, onOpenTicket, onPhoto }: {
  variant: 'repair' | 'scrap';
  title: string;
  tone: 'amber' | 'red';
  icon: React.ReactNode;
  rows: TicketRow[];
  canReturn: boolean;
  onReturn: (r: TicketRow) => void;
  onOpenTicket: (id: string) => void;
  onPhoto: (imgs: LightboxImage[]) => void;
}) {
  const { t } = useTranslation();
  const isRepair = variant === 'repair';
  const s = useSortable(rows, {
    equipment: r => r.equipment,
    plant: r => r.plants?.name,
    ticket: r => r.id,
    closed: r => (r.closed_at ? new Date(r.closed_at) : null),
    status: r => r.status,
    ...(isRepair ? { pending: (r: TicketRow) => repairPending(r) } : {}),
  }, { key: 'closed', dir: 'desc' });
  const { pageRows, controls } = usePagination(s.sorted, { initialPageSize: 10, resetKey: `${rows.length}|${s.sort.key}|${s.sort.dir}` });
  const iconSq = tone === 'amber' ? 'bg-amber-50 text-amber-600' : 'bg-red-50 text-red-600';
  const cols = isRepair ? 9 : 6;
  return (
    <div className="border border-slate-200 rounded-[12px] overflow-hidden">
      {/* Section header — icon square + Poppins title + count pill */}
      <div className="flex items-center gap-2.5 px-4 py-3 bg-slate-50/60 border-b border-slate-100">
        <span className={`w-7 h-7 rounded-lg inline-flex items-center justify-center shrink-0 ${iconSq}`}>{icon}</span>
        <span className="font-heading font-semibold text-[14px] text-slate-800">{title}</span>
        <StatusPill tone={tone} label={rows.length} className="ml-1" />
      </div>
      {rows.length === 0 ? (
        <div className="p-4"><EmptyState title={t('repairScrap.emptySection', { defaultValue: 'No {{what}} yet', what: title.toLowerCase() })} /></div>
      ) : (
        <div className="overflow-x-auto scroll-x">
          <table className="dt2">
            <thead><tr>
              <Th sortKey="equipment" s={s}>{t('repairScrap.colEquipment', 'Equipment')}</Th>
              <Th sortKey="plant" s={s}>{t('repairScrap.colPlant', 'Plant')}</Th>
              <Th sortKey="ticket" s={s}>{t('repairScrap.colTicket', 'Ticket #')}</Th>
              <Th sortKey="closed" s={s} firstDir="desc">{t('repairScrap.colClosed', 'Closed')}</Th>
              {isRepair && <Th sortKey="pending" s={s} firstDir="desc">{t('repairScrap.colReturn', 'Sent · Returned · Pending')}</Th>}
              {isRepair && <th>{t('repairScrap.colReturnStatus', 'Return')}</th>}
              <Th sortKey="status" s={s}>{t('repairScrap.colStatus', 'Status')}</Th>
              <th>{t('repairScrap.colPhoto', 'Photo')}</th>
              {isRepair && <th></th>}
            </tr></thead>
            <tbody>
              {pageRows.map(r => {
                const rs = returnState(r);
                const pending = repairPending(r);
                return (
                  <tr key={r.id} onClick={() => onOpenTicket(r.id)} style={{ cursor: 'pointer' }} title={t('repairScrap.openTicket', 'Open maintenance ticket')}>
                    <td className="font-semibold">{r.equipment}</td>
                    <td className="text-slate-500">{r.plants?.name || '—'}</td>
                    <td><span className="num text-xs text-blue-600 font-semibold">#{r.id.slice(0, 8)}</span></td>
                    <td className="text-slate-500">{fmtDate(r.closed_at)}</td>
                    {isRepair && (
                      <td className="num text-xs text-slate-600">
                        {Number(r.repair_qty ?? 1)} · {Number(r.repair_returned_qty ?? 0)} · <strong style={{ color: pending > 0 ? '#D97706' : '#16A34A' }}>{pending}</strong>
                      </td>
                    )}
                    {isRepair && (
                      <td>
                        <StatusPill
                          tone={rs === 'returned' ? 'green' : rs === 'partial' ? 'blue' : 'amber'}
                          label={t(`repairScrap.return_${rs}`, rs)} />
                      </td>
                    )}
                    <td><StatusPill tone={r.status === 'closed' ? 'green' : 'slate'} label={r.status} /></td>
                    <td>
                      {r.defective_part_photo_url ? (
                        <button
                          type="button"
                          onClick={e => { e.stopPropagation(); onPhoto([{ url: r.defective_part_photo_url as string, label: r.equipment }]); }}
                          title={t('repairScrap.viewPhoto', 'View photo')}
                          style={{ padding: 0, border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden', cursor: 'pointer', background: 'none', lineHeight: 0 }}
                        >
                          <img src={r.defective_part_photo_url} alt={`${r.equipment} photo`} style={{ width: 40, height: 40, objectFit: 'cover', display: 'block' }} loading="lazy" />
                        </button>
                      ) : <span className="text-slate-300">—</span>}
                    </td>
                    {isRepair && (
                      <td>
                        {canReturn && pending > 0 && (
                          <button
                            type="button"
                            onClick={e => { e.stopPropagation(); onReturn(r); }}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 700, color: '#16A34A', background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 8, padding: '4px 10px', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
                            <PackageCheck size={12} /> {t('repairScrap.returnToInventory', 'Return to Inventory')}
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
              {pageRows.length === 0 && <tr><td colSpan={cols} className="text-center text-slate-400 py-6 text-sm">{t('repairScrap.noMatch', 'No rows match.')}</td></tr>}
            </tbody>
          </table>
          <TablePagination controls={controls} />
        </div>
      )}
    </div>
  );
}

/** Append-only return history: every receipt with its per-ticket allocations.
 *  Corrections happen via controlled reversal (offsetting movement) — never
 *  deletion. */
function ReturnHistory({ receipts, allocs, canReverse, onReversed, onOpenTicket, toastError, toastOk }: {
  receipts: ReceiptRow[];
  allocs: AllocRow[];
  canReverse: boolean;
  onReversed: () => void;
  onOpenTicket: (id: string) => void;
  toastError: (m: string) => void;
  toastOk: (m: string) => void;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [reverseFor, setReverseFor] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const byReceipt = useMemo(() => {
    const m = new Map<string, AllocRow[]>();
    for (const a of allocs) { const arr = m.get(a.receipt_id); if (arr) arr.push(a); else m.set(a.receipt_id, [a]); }
    return m;
  }, [allocs]);

  const filtered = useTextFilter(receipts, search, r => [
    r.vendor_name, r.invoice_no, r.actor_name, r.plants?.name, r.id.slice(0, 8),
    ...(byReceipt.get(r.id) || []).map(a => a.item_name),
  ]);

  const s = useSortable(filtered, {
    date: r => (r.return_date ? new Date(r.return_date) : null),
    vendor: r => r.vendor_name,
    invoice: r => r.invoice_no,
    qty: r => (byReceipt.get(r.id) || []).reduce((sum, a) => sum + Number(a.qty), 0),
    by: r => r.actor_name,
    status: r => r.status,
  }, { key: 'date', dir: 'desc' });
  const { pageRows, controls } = usePagination(s.sorted, { initialPageSize: 10, resetKey: `${filtered.length}|${s.sort.key}|${s.sort.dir}` });

  async function doReverse(receiptId: string) {
    if (!reason.trim()) { toastError(t('repairReturn.errReason', 'A reason is required to reverse a return.')); return; }
    setBusy(true);
    try {
      const { error } = await callRpc('reverse_repair_return', { p_receipt_id: receiptId, p_reason: reason.trim() });
      if (error) {
        const raw = error.message || '';
        if (/reversal_blocked/i.test(raw)) throw new Error(t('repairReturn.errReversalBlocked', 'Cannot reverse — some returned units have already been issued from stock.'));
        if (/forbidden: missing capability/i.test(raw)) throw new Error(t('repairReturn.errReverseForbidden', 'You do not have permission to reverse repair returns.'));
        throw new Error(raw);
      }
      toastOk(t('repairReturn.reversed', 'Return reversed — stock and tickets restored.'));
      setReverseFor(null); setReason('');
      onReversed();
    } catch (e) {
      toastError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border border-slate-200 rounded-[12px] overflow-hidden">
      <div className="flex items-center gap-2.5 px-4 py-3 bg-slate-50/60 border-b border-slate-100 flex-wrap">
        <span className="w-7 h-7 rounded-lg inline-flex items-center justify-center shrink-0 bg-green-50 text-green-600"><PackageCheck size={14} /></span>
        <span className="font-heading font-semibold text-[14px] text-slate-800">{t('repairReturn.historyTitle', 'Repair return history')}</span>
        <StatusPill tone="green" label={receipts.length} className="ml-1" />
        <div style={{ marginLeft: 'auto', minWidth: 220 }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('repairReturn.historySearchPh', 'Filter by item, vendor, invoice…')}
            style={{ boxSizing: 'border-box', width: '100%', border: '1px solid #E2E8F0', borderRadius: 8, padding: '6px 10px', fontSize: 12.5, fontFamily: 'inherit', outline: 'none' }} />
        </div>
      </div>
      <div className="overflow-x-auto scroll-x">
        <table className="dt2">
          <thead><tr>
            <Th sortKey="date" s={s} firstDir="desc">{t('repairReturn.colDate', 'Return date')}</Th>
            <Th sortKey="vendor" s={s}>{t('repairReturn.colVendor', 'Vendor')}</Th>
            <Th sortKey="invoice" s={s}>{t('repairReturn.colInvoice', 'Invoice')}</Th>
            <Th sortKey="qty" s={s} firstDir="desc" className="num">{t('repairReturn.colQty', 'Qty')}</Th>
            <Th sortKey="by" s={s}>{t('repairReturn.colBy', 'By')}</Th>
            <Th sortKey="status" s={s}>{t('repairReturn.colStatus', 'Status')}</Th>
            <th>{t('repairReturn.colBill', 'Bill')}</th>
          </tr></thead>
          <tbody>
            {pageRows.map(r => {
              const rowAllocs = byReceipt.get(r.id) || [];
              const totalQty = rowAllocs.reduce((sum, a) => sum + Number(a.qty), 0);
              const isOpen = expanded === r.id;
              return (
                <React.Fragment key={r.id}>
                  <tr onClick={() => setExpanded(isOpen ? null : r.id)} style={{ cursor: 'pointer', opacity: r.status === 'reversed' ? 0.6 : 1 }}>
                    <td className="text-slate-600">{fmtDate(r.return_date)}</td>
                    <td className="text-slate-600">{r.vendor_name || '—'}</td>
                    <td className="text-slate-600">{r.invoice_no || '—'}</td>
                    <td className="num font-bold">{totalQty}</td>
                    <td className="text-slate-500 text-xs">{r.actor_name || '—'}</td>
                    <td><StatusPill tone={r.status === 'active' ? 'green' : 'red'} label={r.status === 'active' ? t('repairReturn.stActive', 'active') : t('repairReturn.stReversed', 'reversed')} /></td>
                    <td onClick={e => e.stopPropagation()}>
                      {r.invoice_url
                        ? <a href={r.invoice_url} target="_blank" rel="noreferrer" className="text-xs text-blue-600 font-semibold">{t('repairReturn.viewBill', 'view')}</a>
                        : <span className="text-slate-300">—</span>}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={7} style={{ background: '#F8FAFC', padding: '10px 14px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: '#475569' }}>
                          {rowAllocs.map(a => (
                            <div key={a.id} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                              <strong>{a.item_name}</strong>
                              <span>+{Number(a.qty)} {t('repairReturn.toRepairedStock', 'to repaired stock')}</span>
                              <button onClick={() => onOpenTicket(a.ticket_id)} style={{ color: '#2563EB', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 600, padding: 0 }}>
                                #{a.ticket_id.slice(0, 8)}
                              </button>
                            </div>
                          ))}
                          <div style={{ color: '#64748B' }}>
                            “{r.comment}”{r.condition_note ? ` · ${r.condition_note}` : ''}{r.repair_cost != null ? ` · ${t('repairReturn.cost', 'Repair cost ₹ (optional)').split(' ')[0]} ₹${Number(r.repair_cost).toLocaleString('en-IN')}` : ''}
                          </div>
                          {r.status === 'reversed' && (
                            <div style={{ color: '#DC2626', fontSize: 11.5 }}>
                              {t('repairReturn.reversedBy', { defaultValue: 'Reversed by {{name}}', name: r.reversed_by_name || '—' })} · {fmtDate(r.reversed_at)} · “{r.reversal_reason}”
                            </div>
                          )}
                          {canReverse && r.status === 'active' && (
                            reverseFor === r.id ? (
                              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
                                <input value={reason} onChange={e => setReason(e.target.value)} placeholder={t('repairReturn.reasonPh', 'reason for the reversal (required)')}
                                  style={{ boxSizing: 'border-box', flex: 1, minWidth: 200, border: '1px solid #E2E8F0', borderRadius: 8, padding: '6px 10px', fontSize: 12.5, fontFamily: 'inherit', outline: 'none' }} />
                                <button disabled={busy} onClick={() => doReverse(r.id)}
                                  style={{ fontSize: 12, fontWeight: 700, color: '#fff', background: '#DC2626', border: 'none', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontFamily: 'inherit', opacity: busy ? 0.6 : 1 }}>
                                  {busy ? t('repairReturn.reversing', 'Reversing…') : t('repairReturn.confirmReverse', 'Confirm reversal')}
                                </button>
                                <button disabled={busy} onClick={() => { setReverseFor(null); setReason(''); }}
                                  style={{ fontSize: 12, fontWeight: 600, color: '#475569', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
                                  {t('repairReturn.cancel', 'Cancel')}
                                </button>
                              </div>
                            ) : (
                              <button onClick={() => { setReverseFor(r.id); setReason(''); }}
                                style={{ alignSelf: 'flex-start', fontSize: 11.5, fontWeight: 700, color: '#DC2626', background: 'none', border: '1px solid #FECACA', borderRadius: 8, padding: '3px 10px', cursor: 'pointer', fontFamily: 'inherit', marginTop: 4 }}>
                                {t('repairReturn.reverse', 'Reverse this return')}
                              </button>
                            )
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
            {pageRows.length === 0 && <tr><td colSpan={7} className="text-center text-slate-400 py-6 text-sm">{t('repairScrap.noMatch', 'No rows match.')}</td></tr>}
          </tbody>
        </table>
        <TablePagination controls={controls} />
      </div>
    </div>
  );
}
