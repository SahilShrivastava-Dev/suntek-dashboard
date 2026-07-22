import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ListChecks, Package, Recycle, Plus, FileText, Hourglass, PackageCheck, Zap } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { insertRows } from '../../../lib/db';
import { useMentionNotifier } from '../../../lib/mentions';
import { useBlacklistGuard } from '../../../lib/blacklist/guard';
import { SlidePanel, PanelField, PanelInput, PanelSelect, PanelTextarea, PanelRow, PanelDivider, OcrUpload, PanelFooter } from '../../../components/SlidePanel';
import { KpiInfoButton } from '../../../components/KpiInfoButton';
import { useToast } from '../../../components/ui/toast';
import { SkeletonRows, ErrorState, EmptyState } from '../../../components/ui/states';
import { ImageLightbox, type LightboxImage } from '../../../components/ui/ImageLightbox';
import { usePagination } from '../../../components/ui/usePagination';
import { useSortable } from '../../../components/ui/useSortable';
import { SegmentTabs, StatCard, SectionCard, ButtonV2, TablePaginationV2, ThV2 as Th } from '../../../components/v2';
import { TableSearch, useTextFilter } from '../../../components/ui/TableSearch';
import { usePlantScope } from '../../../contexts/PlantScopeContext';
import { withEmbedFallback } from '../../../lib/scopedList';
import { StockRegister } from './StockRegister';
import { RepairScrapPanel } from './RepairScrapPanel';
import type { Database } from '../../../lib/database.types';

// ticket_id is added by migration NN_requisition_ticket_link.sql; typed here until
// database.types.ts is regenerated so requisitions raised from a maintenance ticket
// can deep-link back to it.
type ReqRow = Database['public']['Tables']['store_requisitions']['Row']
  & { plants?: { name: string | null } | null; ticket_id?: string | null };

function PicBadge({ url, onOpen }: { url: string | null; onOpen: () => void }) {
  const { t } = useTranslation();
  const Icon = (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
      <circle cx="12" cy="13" r="4"/>
    </svg>
  );
  if (!url) return <span className="pic-badge missing" title={t('storereq.no_pic_yet')}>{Icon}</span>;
  return (
    <button type="button" className="pic-badge" title={t('storereq.pic_on_file')} onClick={onOpen}
      style={{ cursor: 'pointer', border: 'none', background: 'none', padding: 0, color: 'inherit' }}>
      {Icon}
    </button>
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

type StoreTab = 'requirements' | 'stock' | 'scrap';

export function StoreRequisitions() {
  const { t } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  // ?tab= keeps the active tab deep-linkable (single route → no RBAC change).
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get('tab');
  const tab: StoreTab = rawTab === 'stock' || rawTab === 'scrap' ? rawTab : 'requirements';
  const setTab = (k: StoreTab) => {
    setSearchParams(prev => { const p = new URLSearchParams(prev); p.set('tab', k); return p; }, { replace: true });
  };
  const notifyMentions = useMentionNotifier();
  const screenBlacklist = useBlacklistGuard();
  const { scopeQuery, allowedPlants } = usePlantScope();
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [items, setItems] = useState<ReqRow[]>([]);
  const [dbPlants, setDbPlants] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [search, setSearch] = useState('');
  const [lightbox, setLightbox] = useState<LightboxImage[] | null>(null);
  // Row click → requisition detail panel (rows with a linked ticket jump straight to it).
  const [detailReq, setDetailReq] = useState<ReqRow | null>(null);
  const [form, setForm] = useState({ item: '', plant: 'SHD', qty: '', unit: 'nos', priority: 'Normal', notes: '' });

  function openRow(r: ReqRow) {
    if (r.ticket_id) navigate(`/dashboard/purchase/maint?ticket=${r.ticket_id}`);
    else setDetailReq(r);
  }

  const filtered = useTextFilter(items, search, r => [r.item, r.plants?.name, r.id.slice(0, 8), r.status, r.ticket_id ? r.ticket_id.slice(0, 8) : '']);
  const reqSort = useSortable(filtered, {
    reqno: r => r.id,
    ticket: r => r.ticket_id ?? null,
    item: r => r.item,
    plant: r => r.plants?.name,
    qty: r => r.qty,
    stage: r => r.status,
  });
  const { pageRows, controls } = usePagination(reqSort.sorted, { resetKey: `${search}|${reqSort.sort.key}|${reqSort.sort.dir}` });

  async function load() {
    try {
      const { data: plantsData } = await supabase.from('plants').select('id, name')
        .returns<{ id: string; name: string }[]>();
      if (plantsData && plantsData.length > 0) setDbPlants(plantsData);

      const { data, error } = await withEmbedFallback(
        scopeQuery(supabase.from('store_requisitions').select('*, plants(name)'), { unitCol: 'unit_id' }).order('created_at', { ascending: false }).returns<ReqRow[]>(),
        () => scopeQuery(supabase.from('store_requisitions').select('*'), { unitCol: 'unit_id' }).order('created_at', { ascending: false }).returns<ReqRow[]>(),
        'StoreRequisitions.list',
      );
      if (error) throw error;
      setItems(data || []);
      setLoadError(false);
    } catch (err) {
      console.error('[StoreRequisitions] load failed', err);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [scopeQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  // Restrict the plant picker to the user's allowed plants (all if global).
  const plantNames = allowedPlants.length > 0
    ? allowedPlants.map(p => p.name)
    : (dbPlants.length > 0 ? dbPlants.map(p => p.name) : FALLBACK_PLANTS);

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
      toast.error(t('storereq.save_failed', { message: error.message }));
      return;
    }
    if (data) {
      setItems(prev => [data as ReqRow, ...prev]);
      // Notify admin and unit head
      insertRows('notifications', {
        target_roles: ['admin', 'unit_head'],
        title: t('storereq.notif_title', { item: form.item }),
        body: `${form.plant} · ${t('storereq.qty_label')}: ${form.qty} ${form.unit} · ${form.priority}`,
        type: form.priority === 'Urgent' ? 'urgent' : 'info',
        route: '/dashboard/purchase/storereq',
        actor_name: form.plant,
        actor_role: 'warehouse_manager',
        read_by: [],
        plant_id: plant?.id || null, // deliver only to this plant's unit head + admin
      }).then(() => {}, () => {});
      await notifyMentions(form.notes, {
        entityType: 'store_requisition', entityId: (data as ReqRow).id,
        entityLabel: t('storereq.entity_label', { item: form.item }), route: '/dashboard/purchase/storereq',
      });
    }
    const hits = await screenBlacklist(
      [{ value: form.item, label: 'Item' }, { value: form.notes, label: 'Notes' }],
      { workflow: 'Store Requisition', source: 'entry', entityLabel: `Store req · ${form.item}` },
    );
    if (hits.length) {
      const h = hits[0];
      toast.error(t('storereq.blacklist_alert', { value: h.candidate.value, type: h.entry.type, name: h.entry.name, pct: Math.round(h.score * 100) }));
    }
    setSaved(true);
    setTimeout(() => { setOpen(false); setSaved(false); setForm({ item: '', plant: 'SHD', qty: '', unit: 'nos', priority: 'Normal', notes: '' }); }, 1600);
  }

  function handleClose() { setOpen(false); setSaved(false); }

  // Summary tiles for the Requirements tab (computed from the loaded rows).
  const pendingCount   = items.filter(r => r.status === 'pending').length;
  const readyCount     = items.filter(r => ['approved', 'dispatched'].includes(r.status)).length;
  const urgentCount    = items.filter(r => ['high', 'plant_stopper'].includes(r.urgency ?? '')).length;

  return (
    <>
      {/* Tab bar — Requirements · Stock Register · Scrap */}
      <SegmentTabs
        className="mb-5"
        items={[
          { key: 'requirements', label: t('storereq.tab_requirements', 'Requirements'), icon: <ListChecks /> },
          { key: 'stock',        label: t('storereq.tab_stock', 'Stock Register'),      icon: <Package /> },
          { key: 'scrap',        label: t('storereq.tab_scrap', 'Repair/Scrap'),        icon: <Recycle /> },
        ]}
        value={tab}
        onChange={setTab}
      />

      {/* ── Consolidated stock register (uploaded file + live usage) ────────── */}
      {tab === 'stock' && <StockRegister />}

      {/* ── Repair & scrap tracking (post-maintenance asset movement) ───────── */}
      {tab === 'scrap' && <RepairScrapPanel />}

      {tab === 'requirements' && (
      <>
      {/* Summary tiles */}
      <div className="grid grid-cols-12 gap-4 mb-4">
        <StatCard className="col-span-12 sm:col-span-6 lg:col-span-3" icon={<FileText />} tone="blue"
          label={t('storereq.stat_total', 'Total Requirements')} value={String(items.length).padStart(2, '0')}
          caption={t('storereq.stat_total_sub', 'Open requests')} />
        <StatCard className="col-span-12 sm:col-span-6 lg:col-span-3" icon={<Hourglass />} tone="amber"
          label={t('storereq.stat_pending', 'Pending Approval')} value={String(pendingCount).padStart(2, '0')}
          caption={t('storereq.stat_pending_sub', 'Awaiting approval')} />
        <StatCard className="col-span-12 sm:col-span-6 lg:col-span-3" icon={<PackageCheck />} tone="green"
          label={t('storereq.stat_ready', 'Ready to Fulfil')} value={String(readyCount).padStart(2, '0')}
          caption={t('storereq.stat_ready_sub', 'Approved & in progress')} />
        <StatCard className="col-span-12 sm:col-span-6 lg:col-span-3" icon={<Zap />} tone="purple" valueTone={urgentCount > 0 ? 'orange' : 'default'}
          label={t('storereq.stat_urgent', 'Urgent')} value={String(urgentCount).padStart(2, '0')}
          caption={t('storereq.stat_urgent_sub', 'High priority requests')} />
      </div>

      {/* Requirements table */}
      <div className="relative">
        <KpiInfoButton info={{ title: 'Open Store Requirements', what: 'All active store requisitions raised by plant/store keepers across SHD, Rehla, Ganjam, and HQ. Each row shows the approval stage, decision, and photo proof status. New requests are submitted via the "+ Raise request" button.', source: 'Mock data', formLabel: 'Raise request form', formPath: '/dashboard/purchase/storereq', note: 'Currently uses STORE_REQ mock data. Future: Supabase store_reqs table.' }} />
      <SectionCard
        flush
        title={t('storereq.open_req_title')}
        subtitle={t('storereq.open_req_subtitle')}
        actions={
          <ButtonV2 variant="primary" icon={<Plus />} onClick={() => setOpen(true)}>
            {t('storereq.raise_request_btn')}
          </ButtonV2>
        }
      >
        {loadError ? (
          <div className="px-5 pb-5">
            <ErrorState title={t('storereq.load_error_title')} message={t('storereq.load_error_msg')}
              onRetry={() => { setLoading(true); setLoadError(false); load(); }} />
          </div>
        ) : loading ? (
          <div className="px-5 pb-5"><SkeletonRows rows={6} /></div>
        ) : (
        <>
          <div className="px-5 pb-4"><TableSearch value={search} onChange={setSearch} placeholder={t('storereq.search_ph', 'Search item, plant, ticket…')} /></div>
          {filtered.length === 0 ? (
            <div className="px-5 pb-5"><EmptyState title={t('storereq.open_req_empty')} message={search ? t('common.noMatches', 'No rows match your search.') : undefined} /></div>
          ) : (
            <div className="overflow-x-auto scroll-x">
              <table className="dt2">
                <thead>
                  <tr>
                    <Th sortKey="reqno" s={reqSort}>{t('storereq.col_req_no')}</Th><Th sortKey="ticket" s={reqSort}>{t('storereq.col_ticket', 'Ticket #')}</Th><Th sortKey="item" s={reqSort}>{t('storereq.col_item')}</Th><Th sortKey="plant" s={reqSort}>{t('storereq.col_plant')}</Th><Th sortKey="qty" s={reqSort} firstDir="desc" className="num">{t('storereq.col_qty')}</Th>
                    <Th sortKey="stage" s={reqSort}>{t('storereq.col_stage')}</Th><th>{t('storereq.col_awaiting')}</th><th>{t('storereq.col_decision')}</th><th>{t('storereq.col_pic')}</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map(r => {
                    const s = STATUS_STAGE[r.status] || STATUS_STAGE.pending;
                    const stageKey = STATUS_STAGE[r.status] ? r.status : 'pending';
                    return (
                      <tr
                        key={r.id}
                        onClick={() => openRow(r)}
                        style={{ cursor: 'pointer' }}
                        title={r.ticket_id ? t('storereq.open_ticket', 'Open maintenance ticket') : t('storereq.open_detail', 'View request details')}
                      >
                        <td className="font-bold text-xs text-slate-400">{r.id.slice(0, 8)}</td>
                        <td>
                          {r.ticket_id
                            ? <span className="num text-xs text-blue-600 font-semibold">#{r.ticket_id.slice(0, 8)}</span>
                            : <span className="text-slate-300">—</span>}
                        </td>
                        <td>{r.item}</td>
                        <td>{r.plants?.name || '—'}</td>
                        <td className="num">{r.qty}</td>
                        <td>
                          <span className="badge" style={{ background: s.bg, color: s.color }}>{t('storereq.stage_' + stageKey)}</span>
                        </td>
                        <td className="text-slate-500">{r.status === 'pending' ? t('storereq.awaiting_unit_head') : '—'}</td>
                        <td className="font-semibold">{r.status}</td>
                        <td onClick={e => e.stopPropagation()}><PicBadge url={r.photo_url} onOpen={() => r.photo_url && setLightbox([{ url: r.photo_url, label: r.item }])} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <TablePaginationV2 controls={controls} label="requirements" />
            </div>
          )}
        </>
        )}
      </SectionCard>
      </div>
      </>
      )}

      {/* Slide panel */}
      <SlidePanel open={open} onClose={handleClose} title={t('storereq.panel_title')} subtitle={t('storereq.panel_subtitle')}>
        <PanelField label={t('storereq.field_item')}>
          <PanelInput placeholder={t('storereq.ph_item')} value={form.item} onChange={e => set('item', e.target.value)} />
        </PanelField>

        <PanelRow>
          <PanelField label={t('storereq.field_plant')}>
            <PanelSelect value={form.plant} onChange={e => set('plant', e.target.value)}>
              {plantNames.map(p => <option key={p}>{p}</option>)}
            </PanelSelect>
          </PanelField>
          <PanelField label={t('storereq.field_priority')}>
            <PanelSelect value={form.priority} onChange={e => set('priority', e.target.value)}>
              <option value="Normal">{t('storereq.opt_normal')}</option>
              <option value="Urgent">{t('storereq.opt_urgent')}</option>
            </PanelSelect>
          </PanelField>
        </PanelRow>

        <PanelRow>
          <PanelField label={t('storereq.field_quantity')}>
            <PanelInput type="number" placeholder={t('storereq.ph_qty')} value={form.qty} onChange={e => set('qty', e.target.value)} />
          </PanelField>
          <PanelField label={t('storereq.field_unit')}>
            <PanelSelect value={form.unit} onChange={e => set('unit', e.target.value)}>
              {UNITS.map(u => <option key={u}>{u}</option>)}
            </PanelSelect>
          </PanelField>
        </PanelRow>

        <PanelField label={t('storereq.field_reason')}>
          <PanelTextarea placeholder={t('storereq.ph_reason')} value={form.notes} onChange={e => set('notes', e.target.value)} />
        </PanelField>

        <PanelDivider />

        <OcrUpload
          label={t('storereq.ocr_label')}
          hint={t('storereq.ocr_hint')}
          fields={[
            { key: 'item',  label: t('storereq.ocr_field_item'), value: 'Mechanical seal — pump P-104' },
            { key: 'qty',   label: t('storereq.ocr_field_qty'),  value: '2' },
            { key: 'notes', label: t('storereq.ocr_field_notes'), value: 'Worn seal causing leakage at flange joint' },
          ]}
          onExtracted={data => {
            if (data.item)  set('item',  data.item);
            if (data.qty)   set('qty',   data.qty);
            if (data.notes) set('notes', data.notes);
          }}
        />

        <div style={{ fontSize: 11, color: '#94A3B8', marginBottom: 16 }}>
          {t('storereq.panel_helper')}
        </div>

        <PanelFooter
          saved={saved}
          onCancel={handleClose}
          onSave={handleSave}
          saveLabel={t('storereq.save_label')}
          successLabel={t('storereq.success_label')}
          successSub={t('storereq.success_sub')}
          disabled={!form.item.trim() || !form.qty}
          requiredHint={t('storereq.required_hint')}
        />
      </SlidePanel>

      {/* ── PANEL: Requisition detail (rows without a linked ticket) ─────── */}
      <SlidePanel
        open={!!detailReq}
        onClose={() => setDetailReq(null)}
        title={detailReq?.item || t('storereq.detail_title', 'Requisition')}
        subtitle={detailReq ? `#${detailReq.id.slice(0, 8)} · ${detailReq.plants?.name || '—'}` : ''}
      >
        {detailReq && (() => {
          const s = STATUS_STAGE[detailReq.status] || STATUS_STAGE.pending;
          const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '9px 0', borderBottom: '1px solid #F1F5F9' }}>
              <span style={{ fontSize: 12, color: '#94A3B8' }}>{k}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#0F172A', textAlign: 'right' }}>{v}</span>
            </div>
          );
          return (
            <div>
              <Row k={t('storereq.col_req_no')} v={`#${detailReq.id.slice(0, 8)}`} />
              <Row k={t('storereq.col_item')} v={detailReq.item} />
              <Row k={t('storereq.col_plant')} v={detailReq.plants?.name || '—'} />
              <Row k={t('storereq.col_qty')} v={String(detailReq.qty)} />
              <Row k={t('storereq.field_priority')} v={detailReq.urgency === 'high' || detailReq.urgency === 'plant_stopper' ? t('storereq.opt_urgent') : t('storereq.opt_normal')} />
              <Row k={t('storereq.col_stage')} v={<span className="badge" style={{ background: s.bg, color: s.color }}>{s.label}</span>} />
              <Row k={t('storereq.col_decision')} v={detailReq.status} />
              {detailReq.remarks && <Row k={t('storereq.field_reason')} v={detailReq.remarks} />}
              <Row k={t('storereq.detail_requested', 'Requested on')} v={detailReq.created_at ? new Date(detailReq.created_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'} />
              {detailReq.photo_url && (
                <button
                  type="button"
                  onClick={() => setLightbox([{ url: detailReq.photo_url as string, label: detailReq.item }])}
                  style={{ marginTop: 14, padding: 0, border: '1px solid #E2E8F0', borderRadius: 12, overflow: 'hidden', cursor: 'pointer', background: 'none', lineHeight: 0, width: '100%' }}
                  title={t('storereq.pic_on_file')}
                >
                  <img src={detailReq.photo_url} alt={detailReq.item} style={{ width: '100%', maxHeight: 220, objectFit: 'cover', display: 'block' }} />
                </button>
              )}
            </div>
          );
        })()}
      </SlidePanel>

      <ImageLightbox images={lightbox || []} open={!!lightbox} onClose={() => setLightbox(null)} />
    </>
  );
}
