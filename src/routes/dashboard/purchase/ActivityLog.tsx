import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../../lib/supabase';
import { insertRows } from '../../../lib/db';
import { SlidePanel, PanelField, PanelInput, PanelSelect, PanelTextarea, PanelRow, PanelDivider, OcrUpload, PanelFooter } from '../../../components/SlidePanel';
import { KpiInfoButton } from '../../../components/KpiInfoButton';
import { useToast } from '../../../components/ui/toast';
import { SkeletonRows, ErrorState } from '../../../components/ui/states';
import { useDirectory, extractMentionIds, truncate } from '../../../lib/mentions';
import { useBlacklistGuard } from '../../../lib/blacklist/guard';
import { useRoleContext } from '../../../contexts/RoleContext';
import { usePlantScope } from '../../../contexts/PlantScopeContext';
import { withEmbedFallback } from '../../../lib/scopedList';
import { useNotifications } from '../../../contexts/NotificationsContext';
import type { Database } from '../../../lib/database.types';

type Tables = Database['public']['Tables'];
type PlantRel = { plants?: { name: string | null } | null };
type ActivityRow = Tables['activity_logs']['Row'] & PlantRel;
type TicketRow = Tables['maintenance_tickets']['Row'] & PlantRel;
type StoreReqRow = Tables['maintenance_store_requests']['Row'];

// One normalized row for the unified timeline — whether it came from the
// activity_logs table (manual) or was derived from the maintenance workflow.
type UnifiedRow = {
  key: string;
  equipment: string;
  type: string;            // event kind / activity type
  date: string;            // ISO or YYYY-MM-DD
  doneBy: string | null;
  verifiedBy: string | null;
  plant: string | null;
  hasPhoto: boolean;
  ticketRef: string | null;   // short maintenance ticket id, e.g. "f855d730"
  source: 'manual' | 'maintenance';
};

const ticketRef = (id: string) => id.slice(0, 8);
const toMs = (ts: string | null | undefined) => (ts ? new Date(ts).getTime() : 0);
const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

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

const PLANTS = ['SHD', 'Rehla', 'Ganjam', 'HQ'];

// Build the derived maintenance-lifecycle events. Each milestone (raised, part
// procured, part handed over, repair completed, defective part decided) becomes
// one timeline row — so the Activity Log is the single overall record of "what
// happened, where, by whom, with proof", keyed by the maintenance ticket #.
function deriveMaintenanceEvents(tickets: TicketRow[], srs: StoreReqRow[]): UnifiedRow[] {
  const srByTicket = new Map<string, StoreReqRow[]>();
  for (const s of srs) {
    if (!s.ticket_id) continue;
    (srByTicket.get(s.ticket_id) ?? srByTicket.set(s.ticket_id, []).get(s.ticket_id)!).push(s);
  }

  const out: UnifiedRow[] = [];
  for (const tk of tickets) {
    const ref = ticketRef(tk.id);
    const plant = tk.plants?.name ?? null;
    const kindWord = tk.type === 'emergency' ? 'Emergency' : 'Periodic';

    // 1) Raised
    out.push({
      key: `${tk.id}:raised`, equipment: tk.equipment, type: `${kindWord} raised`,
      date: tk.created_at, doneBy: tk.raised_by || tk.assigned_to || null,
      verifiedBy: null, plant, hasPhoto: false, ticketRef: ref, source: 'maintenance',
    });

    // Store-request driven milestones
    for (const sr of srByTicket.get(tk.id) ?? []) {
      if (sr.supplier_name || sr.busy_transaction_ref) {
        out.push({
          key: `${sr.id}:procured`, equipment: tk.equipment,
          type: `Part procured · ${sr.part_name}`, date: tk.closed_at || sr.created_at,
          doneBy: sr.supplier_name || 'Procurement', verifiedBy: null, plant,
          hasPhoto: !!sr.handover_invoice_url, ticketRef: ref, source: 'maintenance',
        });
      }
      if (sr.handover_confirmed_at) {
        out.push({
          key: `${sr.id}:handover`, equipment: tk.equipment,
          type: `Part handed over · ${sr.part_name}`, date: sr.handover_confirmed_at,
          doneBy: 'Store', verifiedBy: null, plant,
          hasPhoto: !!(sr.handover_photo_url || sr.handover_invoice_url), ticketRef: ref, source: 'maintenance',
        });
      }
    }

    // 2) Defective-part decision
    if (tk.defective_part_decision) {
      out.push({
        key: `${tk.id}:defective`, equipment: tk.equipment,
        type: `Defective part ${tk.defective_part_decision === 'scrap' ? 'scrapped' : 'sent for repair'}`,
        date: tk.closed_at || tk.created_at, doneBy: tk.assigned_to || null, verifiedBy: null, plant,
        hasPhoto: !!tk.defective_part_photo_url, ticketRef: ref, source: 'maintenance',
      });
    }

    // 3) Completed / closed
    if (tk.status === 'closed') {
      out.push({
        key: `${tk.id}:done`, equipment: tk.equipment,
        type: tk.type === 'emergency' ? 'Repair completed' : 'Periodic check completed',
        date: tk.closed_at || tk.created_at, doneBy: tk.assigned_to || null,
        verifiedBy: tk.raised_role || null,
        plant, hasPhoto: !!(tk.completion_photo_url || tk.defective_part_photo_url),
        ticketRef: ref, source: 'maintenance',
      });
    }
  }
  return out;
}

export function ActivityLog() {
  const { t } = useTranslation();
  const toast = useToast();
  const people = useDirectory();
  const { activeProfile } = useRoleContext();
  const { scopeQuery } = usePlantScope();
  const { addNotification } = useNotifications();
  const screenBlacklist = useBlacklistGuard();
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [logs, setLogs] = useState<ActivityRow[]>([]);
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [storeReqs, setStoreReqs] = useState<StoreReqRow[]>([]);
  const [dbPlants, setDbPlants] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [showManualOnly, setShowManualOnly] = useState(false);
  const today = new Date().toISOString().split('T')[0];
  const [form, setForm] = useState({ equipment: '', type: 'Regular', date: today, doneBy: '', verifiedBy: '', plant: 'SHD', notes: '' });

  async function load() {
    try {
      const { data: plantsData } = await supabase.from('plants').select('id, name')
        .returns<{ id: string; name: string }[]>();
      if (plantsData && plantsData.length > 0) setDbPlants(plantsData);

      const [logsRes, ticketsRes] = await Promise.all([
        withEmbedFallback(
          scopeQuery(supabase.from('activity_logs').select('*, plants(name)')).order('date', { ascending: false }).returns<ActivityRow[]>(),
          () => scopeQuery(supabase.from('activity_logs').select('*')).order('date', { ascending: false }).returns<ActivityRow[]>(),
          'ActivityLog.logs',
        ),
        withEmbedFallback(
          scopeQuery(supabase.from('maintenance_tickets').select('*, plants(name)'), { unitCol: 'unit_id' }).order('created_at', { ascending: false }).returns<TicketRow[]>(),
          () => scopeQuery(supabase.from('maintenance_tickets').select('*'), { unitCol: 'unit_id' }).order('created_at', { ascending: false }).returns<TicketRow[]>(),
          'ActivityLog.tickets',
        ),
      ]);
      if (logsRes.error) throw logsRes.error;
      setLogs(logsRes.data || []);

      const tks = ticketsRes.data || [];
      setTickets(tks);
      const ids = tks.map(x => x.id);
      if (ids.length) {
        const { data: srData } = await supabase.from('maintenance_store_requests').select('*').in('ticket_id', ids).returns<StoreReqRow[]>();
        setStoreReqs(srData || []);
      } else {
        setStoreReqs([]);
      }
      setLoadError(false);
    } catch (err) {
      console.error('[ActivityLog] load failed', err);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [scopeQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  // Merge manual entries + derived maintenance events into one sorted timeline.
  const rows = useMemo<UnifiedRow[]>(() => {
    const manual: UnifiedRow[] = logs.map((a, i) => ({
      key: a.id || `manual-${i}`,
      equipment: a.equipment || '—',
      type: a.type,
      date: a.date,
      doneBy: a.done_by,
      verifiedBy: a.verified_by,
      plant: a.plants?.name ?? null,
      hasPhoto: !!a.photo_url,
      ticketRef: null,
      source: 'manual',
    }));
    const derived = deriveMaintenanceEvents(tickets, storeReqs);
    const all = showManualOnly ? manual : [...manual, ...derived];
    return all.sort((a, b) => toMs(b.date) - toMs(a.date));
  }, [logs, tickets, storeReqs, showManualOnly]);

  const fromMaintenance = rows.filter(r => r.source === 'maintenance').length;
  const verified = rows.filter(r => r.verifiedBy).length;
  const withPhoto = rows.length ? Math.round((rows.filter(r => r.hasPhoto).length / rows.length) * 100) : 0;

  const plantNames = dbPlants.length > 0 ? dbPlants.map(p => p.name) : PLANTS;

  function set(k: string, v: string) { setForm(f => ({ ...f, [k]: v })); }

  async function handleSave() {
    if (!form.equipment.trim() || !form.doneBy.trim()) return;
    const plant = dbPlants.find(p => p.name === form.plant);
    const { data, error } = await insertRows('activity_logs', {
      equipment: form.equipment,
      type: form.type.toLowerCase(),
      date: form.date,
      done_by: form.doneBy,
      verified_by: form.verifiedBy || null,
      plant_id: plant?.id || null,
    }).select('*, plants(name)').single();

    if (error) {
      toast.error(t('activity.saveFailed', { message: error.message }));
      return;
    }
    if (data) setLogs(prev => [data as ActivityRow, ...prev]);

    // Notify anyone @-tagged in the notes (Teams-style heads-up).
    const mentionIds = extractMentionIds(form.notes, people).filter(id => id !== activeProfile.id);
    if (mentionIds.length) {
      await addNotification({
        target_roles: mentionIds,
        title: t('activity.taggedTitle', { name: activeProfile.name }),
        body: `${form.equipment}: “${truncate(form.notes)}”`,
        type: 'info',
        route: '/dashboard/purchase/activity',
        actor_name: activeProfile.name,
        actor_role: activeProfile.roleLabel,
      });
    }

    // Screen the people/equipment named on this entry against the blacklist.
    const hits = await screenBlacklist(
      [
        { value: form.doneBy, label: 'Done by' },
        { value: form.verifiedBy, label: 'Verified by' },
        { value: form.equipment, label: 'Equipment' },
      ],
      { workflow: 'Activity Log', source: 'entry', entityLabel: form.equipment },
    );
    if (hits.length) {
      const h = hits[0];
      toast.error(t('activity.blacklistHit', { value: h.candidate.value, type: h.entry.type, name: h.entry.name, pct: Math.round(h.score * 100) }));
    }

    setSaved(true);
    setTimeout(() => { setOpen(false); setSaved(false); setForm({ equipment: '', type: 'Regular', date: today, doneBy: '', verifiedBy: '', plant: 'SHD', notes: '' }); }, 1600);
  }

  function handleClose() { setOpen(false); setSaved(false); }

  return (
    <>
      {/* KPI row */}
      <div className="grid grid-cols-12 gap-5 mb-5">
        <div className="col-span-12 lg:col-span-3 card p-5" style={{ position: 'relative' }}>
          <KpiInfoButton info={{ title: 'All activity events', what: 'Every activity across all plants — manual log entries PLUS milestones auto-fed from the maintenance workflow (raised, procured, handed over, completed, defective decided). The single overall record.', source: 'Derived', note: 'Manual activity_logs + maintenance_tickets / maintenance_store_requests milestones.' }} />
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">{t('activity.kpiTotal')}</div>
          <div className="text-[28px] font-extrabold mt-1 num">{rows.length}</div>
          <div className="text-[11px] text-slate-500 mt-1">{t('activity.kpiFromMaintenance', { count: fromMaintenance })}</div>
        </div>
        <div className="col-span-12 lg:col-span-3 card p-5" style={{ position: 'relative' }}>
          <KpiInfoButton info={{ title: 'Verified', what: 'Activity events that carry a verifier (supervisor / unit head sign-off, or the raising role on a completed maintenance ticket).', source: 'Derived' }} />
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">{t('activity.kpiVerified')}</div>
          <div className="text-[28px] font-extrabold mt-1 num text-green-600">{verified}</div>
        </div>
        <div className="col-span-12 lg:col-span-3 card p-5" style={{ position: 'relative' }}>
          <KpiInfoButton info={{ title: 'Pending verification', what: 'Events with no verifier yet. These need supervisor sign-off.', source: 'Derived' }} />
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">{t('activity.kpiPending')}</div>
          <div className="text-[28px] font-extrabold mt-1 num text-amber-600">{rows.length - verified}</div>
        </div>
        <div className="col-span-12 lg:col-span-3 card p-5" style={{ position: 'relative' }}>
          <KpiInfoButton info={{ title: 'Photo proof coverage', what: 'Percentage of activity events that carry photo proof — manual uploads plus the completion / handover / defective-part photos captured through the maintenance workflow.', source: 'Derived' }} />
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">{t('activity.kpiPhotoProof')}</div>
          <div className="text-[28px] font-extrabold mt-1 num">{withPhoto}%</div>
        </div>
      </div>

      {/* Table — amber-soft */}
      <div className="card p-6" style={{ background: 'var(--amber-soft)', border: '1px solid #fde68a', position: 'relative' }}>
        <KpiInfoButton info={{ title: 'Activity log book', what: 'The overall record of activity across all plants. Maintenance milestones flow in automatically and are tagged with their ticket #; ad-hoc work is added with "+ Log activity". Every row aims to carry photo proof.', source: 'Derived', note: 'Auto-fed from the maintenance workflow + manual activity_logs entries.' }} />
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div>
            <div className="text-base font-bold">{t('activity.logBookTitle')}</div>
            <div className="text-xs text-slate-500">{t('activity.logBookSubtitle')}</div>
          </div>
          <div className="flex items-center gap-2">
            <button
              className={`pill px-3 py-2 text-xs font-semibold ${showManualOnly ? 'btn-ghost' : 'btn-ghost'}`}
              style={{ border: '1px solid #E2E8F0', background: showManualOnly ? '#fff' : '#0F172A', color: showManualOnly ? '#475569' : '#fff' }}
              onClick={() => setShowManualOnly(v => !v)}
              title={t('activity.toggleFeedTitle')}
            >
              {showManualOnly ? t('activity.showMaintenanceFeed') : t('activity.manualOnly')}
            </button>
            <button className="btn-accent pill px-4 py-2 font-semibold text-sm" onClick={() => setOpen(true)}>
              {t('activity.logActivityBtn')}
            </button>
          </div>
        </div>
        {loadError ? (
          <ErrorState title={t('activity.errorTitle')} message={t('activity.errorMessage')}
            onRetry={() => { setLoading(true); setLoadError(false); load(); }} />
        ) : loading ? (
          <SkeletonRows rows={6} />
        ) : (
        <div className="overflow-x-auto scroll-x">
          <table className="dt">
            <thead>
              <tr>
                <th>{t('activity.colEquipment')}</th><th>{t('activity.colActivity')}</th><th>{t('activity.colTicket')}</th><th>{t('activity.colDate')}</th>
                <th>{t('activity.colDoneBy')}</th><th>{t('activity.colVerifiedBy')}</th><th>{t('activity.colPlant')}</th><th>{t('activity.colPic')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.key} style={{ cursor: 'default' }}>
                  <td className="font-semibold">{a.equipment || '—'}</td>
                  <td className="text-slate-600">
                    {a.type}
                    {a.source === 'maintenance' && (
                      <span className="badge" style={{ marginLeft: 6, background: '#E0F2FE', color: '#0369A1', fontWeight: 700, fontSize: 10 }}>{t('activity.autoBadge')}</span>
                    )}
                  </td>
                  <td>{a.ticketRef ? <span className="num text-xs text-slate-500">#{a.ticketRef}</span> : <span className="text-slate-300">—</span>}</td>
                  <td className="text-slate-500 text-xs">{fmtDate(a.date)}</td>
                  <td>{a.doneBy || '—'}</td>
                  <td className="text-slate-500">{a.verifiedBy || '—'}</td>
                  <td>{a.plant || '—'}</td>
                  <td><PicBadge has={a.hasPhoto} /></td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={8} className="text-center text-slate-400 py-6 text-sm">{t('activity.emptyState')}</td></tr>
              )}
            </tbody>
          </table>
        </div>
        )}
      </div>

      {/* Slide panel */}
      <SlidePanel open={open} onClose={handleClose} title={t('activity.panelTitle')} subtitle={t('activity.panelSubtitle')}>
        <PanelField label={t('activity.fieldEquipment')}>
          <PanelInput placeholder={t('activity.phEquipment')} value={form.equipment} onChange={e => set('equipment', e.target.value)} />
        </PanelField>

        <PanelRow>
          <PanelField label={t('activity.fieldActivityType')}>
            <PanelSelect value={form.type} onChange={e => set('type', e.target.value)}>
              <option value="Regular">{t('activity.typeRegular')}</option>
              <option value="Repair">{t('activity.typeRepair')}</option>
              <option value="Scrap">{t('activity.typeScrap')}</option>
              <option value="Inspection">{t('activity.typeInspection')}</option>
              <option value="Calibration">{t('activity.typeCalibration')}</option>
            </PanelSelect>
          </PanelField>
          <PanelField label={t('activity.fieldPlant')}>
            <PanelSelect value={form.plant} onChange={e => set('plant', e.target.value)}>
              {plantNames.map(p => <option key={p}>{p}</option>)}
            </PanelSelect>
          </PanelField>
        </PanelRow>

        <PanelRow>
          <PanelField label={t('activity.fieldDate')}>
            <PanelInput type="date" value={form.date} onChange={e => set('date', e.target.value)} />
          </PanelField>
          <PanelField label={t('activity.fieldDoneBy')}>
            <PanelInput placeholder={t('activity.phDoneBy')} value={form.doneBy} onChange={e => set('doneBy', e.target.value)} />
          </PanelField>
        </PanelRow>

        <PanelField label={t('activity.fieldVerifiedBy')}>
          <PanelInput placeholder={t('activity.phVerifiedBy')} value={form.verifiedBy} onChange={e => set('verifiedBy', e.target.value)} />
        </PanelField>

        <PanelField label={t('activity.fieldNotes')}>
          <PanelTextarea placeholder={t('activity.phNotes')} value={form.notes} onChange={e => set('notes', e.target.value)} />
        </PanelField>

        <PanelDivider />

        <OcrUpload
          label={t('activity.ocrLabel')}
          hint={t('activity.ocrHint')}
          fields={[
            { key: 'equipment', label: 'Equipment ID',  value: 'Atlas Copco GA18 — SHD-AC-04' },
            { key: 'type',      label: 'Activity type', value: 'Repair' },
            { key: 'notes',     label: 'Work summary',  value: 'Replaced V-belt drive + tightened coupling bolts' },
          ]}
          onExtracted={data => {
            if (data.equipment) set('equipment', data.equipment);
            if (data.type)      set('type',      data.type);
            if (data.notes)     set('notes',     data.notes);
          }}
        />

        <PanelFooter
          saved={saved}
          onCancel={handleClose}
          onSave={handleSave}
          saveLabel={t('activity.saveLabel')}
          successLabel={t('activity.successLabel')}
          successSub={t('activity.successSub')}
          disabled={!form.equipment.trim() || !form.doneBy.trim()}
          requiredHint={t('activity.requiredHint')}
        />
      </SlidePanel>
    </>
  );
}
