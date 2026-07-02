import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../../lib/supabase';
import { insertRows } from '../../../lib/db';
import { useMentionNotifier } from '../../../lib/mentions';
import { useBlacklistGuard } from '../../../lib/blacklist/guard';
import { SlidePanel, PanelField, PanelInput, PanelSelect, PanelTextarea, PanelRow, PanelDivider, OcrUpload, PanelFooter } from '../../../components/SlidePanel';
import { KpiInfoButton } from '../../../components/KpiInfoButton';
import { useToast } from '../../../components/ui/toast';
import { SkeletonRows, ErrorState } from '../../../components/ui/states';
import { usePlantScope } from '../../../contexts/PlantScopeContext';
import { withEmbedFallback } from '../../../lib/scopedList';
import type { Database } from '../../../lib/database.types';

type ReqRow = Database['public']['Tables']['store_requisitions']['Row'] & { plants?: { name: string | null } | null };
type MaintStoreReq = Database['public']['Tables']['maintenance_store_requests']['Row'];
type MaintTicket = Database['public']['Tables']['maintenance_tickets']['Row'] & { plants?: { name: string | null } | null };

const UNIT_LABELS: Record<string, string> = { chlorides: 'Suntek Chlorides', plasticiser: 'Suntek Plasticiser' };

/** A store-register row, DERIVED from a maintenance store request (single source). */
interface RegisterRow {
  id: string; part: string; store: string; equipment: string;
  inStore: number; requested: number; remaining: number;
  ticketRef: string; hasPhoto: boolean;
}
function regStatus(remaining: number): { key: string; bg: string; color: string } {
  if (remaining <= 0) return { key: 'stock_out', bg: '#FEE2E2', color: '#DC2626' };
  if (remaining <= 2) return { key: 'stock_low', bg: '#FEF3C7', color: '#D97706' };
  return { key: 'stock_in', bg: '#DCFCE7', color: '#16A34A' };
}

function PicBadge({ has }: { has: boolean }) {
  const { t } = useTranslation();
  return (
    <span className={`pic-badge${has ? '' : ' missing'}`} title={has ? t('storereq.pic_on_file') : t('storereq.no_pic_yet')}>
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
  const { t } = useTranslation();
  const toast = useToast();
  const notifyMentions = useMentionNotifier();
  const screenBlacklist = useBlacklistGuard();
  const { scopeQuery, allowedPlants } = usePlantScope();
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [items, setItems] = useState<ReqRow[]>([]);
  const [dbPlants, setDbPlants] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [form, setForm] = useState({ item: '', plant: 'SHD', qty: '', unit: 'nos', priority: 'Normal', notes: '' });
  // Store register — derived from the maintenance store requests (in-store path)
  const [register, setRegister] = useState<RegisterRow[]>([]);
  const [storeFilter, setStoreFilter] = useState<string[]>([]); // empty = all stores

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

      // Derive the store register from the maintenance flow (parent source):
      // in-store store requests become register rows; remaining = in-store − requested.
      const { data: tickets } = await supabase.from('maintenance_tickets')
        .select('*, plants(name)').eq('type', 'emergency').returns<MaintTicket[]>();
      const tIds = (tickets || []).map(t => t.id);
      let srs: MaintStoreReq[] = [];
      if (tIds.length) {
        const { data: srData } = await supabase.from('maintenance_store_requests').select('*').in('ticket_id', tIds).returns<MaintStoreReq[]>();
        srs = srData || [];
      }
      const tById = new Map((tickets || []).map(t => [t.id, t]));
      const reg: RegisterRow[] = srs
        .filter(s => s.store_decision === 'available')
        .map(s => {
          const t = tById.get(s.ticket_id);
          const store = t?.unit ? (UNIT_LABELS[t.unit] || t.unit) : (t?.plants?.name || 'Store');
          const inStore = Number(s.qty_in_store ?? 0);
          const requested = Number(s.quantity ?? 0);
          return {
            id: s.id, part: s.part_name, store, equipment: t?.equipment || '',
            inStore, requested, remaining: Math.max(0, inStore - requested),
            ticketRef: s.ticket_id.slice(0, 8),
            hasPhoto: !!(s.handover_photo_url || s.handover_invoice_url),
          };
        });
      setRegister(reg);
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

  // ── Store register derived ────────────────────────────────────────────────
  const stores = [...new Set(register.map(r => r.store))].sort();
  const shownReg = storeFilter.length ? register.filter(r => storeFilter.includes(r.store)) : register;
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

  return (
    <>
      {/* Approval flow */}
      <div className="card p-6 mb-5" style={{ position: 'relative' }}>
        <KpiInfoButton info={{ title: 'Store Req Approval Flow', what: 'The 4-stage sign-off chain for any store/material requisition. Stage 4 (purchase approval by Vijay Ji) only triggers when the item is not in stock. This is a manual process tracked in this dashboard.', source: 'Form entry', formLabel: 'Raise request form', formPath: '/dashboard/purchase/storereq', note: 'Dummy flow diagram — actual stage tracking is in the STORE_REQ list below.' }} />
        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-3">{t('storereq.approval_flow')}</div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="tile flex-1 min-w-[160px]">
            <div className="text-[11px] text-slate-500">1 · {t('storereq.flow_raised_by')}</div>
            <div className="font-semibold text-sm mt-1">{t('storereq.flow_plant_keeper')}</div>
          </div>
          <ArrowRight />
          <div className="tile flex-1 min-w-[160px]">
            <div className="text-[11px] text-slate-500">2 · {t('storereq.flow_approved_by')}</div>
            <div className="font-semibold text-sm mt-1">{t('storereq.flow_unit_head')}</div>
          </div>
          <ArrowRight />
          <div className="tile flex-1 min-w-[160px]">
            <div className="text-[11px] text-slate-500">3 · {t('storereq.flow_stock_check')}</div>
            <div className="font-semibold text-sm mt-1">{t('storereq.flow_in_stock_supply')}</div>
          </div>
          <ArrowRight />
          <div className="tile flex-1 min-w-[160px]">
            <div className="text-[11px] text-slate-500">4 · {t('storereq.flow_otherwise')}</div>
            <div className="font-semibold text-sm mt-1">Vijay Ji {t('storereq.flow_approves_purchase')}</div>
          </div>
        </div>
      </div>

      {/* ── Store register (maintenance spare-parts inventory) ──────────────── */}
      <div className="card p-6 mb-5">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
          <div>
            <div className="text-base font-bold">{t('storereq.register_title')}</div>
            <div className="text-xs text-slate-500">{t('storereq.register_subtitle')}</div>
          </div>
          <div className="flex items-center gap-3 text-[11px]">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><span style={{ width: 9, height: 9, borderRadius: '50%', background: '#16A34A', display: 'inline-block' }} /> {t('storereq.legend_in_stock')}</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><span style={{ width: 9, height: 9, borderRadius: '50%', background: '#D97706', display: 'inline-block' }} /> {t('storereq.legend_low')}</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><span style={{ width: 9, height: 9, borderRadius: '50%', background: '#DC2626', display: 'inline-block' }} /> {t('storereq.legend_out')}</span>
          </div>
        </div>

        {/* Store filter — single / multi / all */}
        {stores.length > 0 && (
          <div className="flex gap-2 mb-4 flex-wrap">
            <button onClick={() => setStoreFilter([])} className={`chip${storeFilter.length === 0 ? ' active' : ''}`}>{t('storereq.all_stores')}</button>
            {stores.map(s => (
              <button key={s} onClick={() => toggleStore(s)} className={`chip${storeFilter.includes(s) ? ' active' : ''}`}>{s}</button>
            ))}
          </div>
        )}

        <div className="overflow-x-auto scroll-x">
          <table className="dt">
            <thead><tr><th>{t('storereq.col_ticket')}</th><th>{t('storereq.col_part')}</th><th>{t('storereq.col_equipment')}</th><th>{t('storereq.col_store')}</th><th className="num">{t('storereq.col_in_store')}</th><th className="num">{t('storereq.col_requested')}</th><th className="num">{t('storereq.col_remaining')}</th><th>{t('storereq.col_status')}</th><th>{t('storereq.col_pic')}</th></tr></thead>
            <tbody>
              {shownReg.length === 0 && (
                <tr><td colSpan={9} className="text-center text-slate-400 py-6 text-sm">{t('storereq.register_empty')}</td></tr>
              )}
              {shownReg.map(r => {
                const st = regStatus(r.remaining);
                return (
                  <tr key={r.id}>
                    <td className="num text-xs text-slate-500">#{r.ticketRef}</td>
                    <td className="font-semibold text-slate-700">{r.part}</td>
                    <td className="text-slate-500 text-xs">{r.equipment}</td>
                    <td className="text-slate-500 text-xs">{r.store}</td>
                    <td className="num">{r.inStore}</td>
                    <td className="num">{r.requested}</td>
                    <td className="num font-bold" style={{ color: st.color }}>{r.remaining}</td>
                    <td><span className="badge" style={{ background: st.bg, color: st.color, fontWeight: 700 }}>{t('storereq.' + st.key)}</span></td>
                    <td title={t('storereq.pic_supplied_title')}><PicBadge has={r.hasPhoto} /></td>
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
            <div className="text-base font-bold">{t('storereq.open_req_title')}</div>
            <div className="text-xs text-slate-500">{t('storereq.open_req_subtitle')}</div>
          </div>
          <button className="btn-accent pill px-4 py-2 font-semibold text-sm" onClick={() => setOpen(true)}>
            + {t('storereq.raise_request_btn')}
          </button>
        </div>
        {loadError ? (
          <ErrorState title={t('storereq.load_error_title')} message={t('storereq.load_error_msg')}
            onRetry={() => { setLoading(true); setLoadError(false); load(); }} />
        ) : loading ? (
          <SkeletonRows rows={6} />
        ) : (
        <div className="overflow-x-auto scroll-x">
          <table className="dt">
            <thead>
              <tr>
                <th>{t('storereq.col_req_no')}</th><th>{t('storereq.col_item')}</th><th>{t('storereq.col_plant')}</th><th className="num">{t('storereq.col_qty')}</th>
                <th>{t('storereq.col_stage')}</th><th>{t('storereq.col_awaiting')}</th><th>{t('storereq.col_decision')}</th><th>{t('storereq.col_pic')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map(r => {
                const s = STATUS_STAGE[r.status] || STATUS_STAGE.pending;
                const stageKey = STATUS_STAGE[r.status] ? r.status : 'pending';
                return (
                  <tr key={r.id} style={{ cursor: 'pointer' }}>
                    <td className="font-bold text-xs text-slate-400">{r.id.slice(0, 8)}</td>
                    <td>{r.item}</td>
                    <td>{r.plants?.name || '—'}</td>
                    <td className="num">{r.qty}</td>
                    <td>
                      <span className="badge" style={{ background: s.bg, color: s.color }}>{t('storereq.stage_' + stageKey)}</span>
                    </td>
                    <td className="text-slate-500">{r.status === 'pending' ? t('storereq.awaiting_unit_head') : '—'}</td>
                    <td className="font-semibold">{r.status}</td>
                    <td><PicBadge has={!!r.photo_url} /></td>
                  </tr>
                );
              })}
              {items.length === 0 && (
                <tr><td colSpan={8} className="text-center text-slate-400 py-6 text-sm">{t('storereq.open_req_empty')}</td></tr>
              )}
            </tbody>
          </table>
        </div>
        )}
      </div>

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
    </>
  );
}
