import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useTable } from '../../hooks/useTable';
import { useToast } from '../../components/ui/toast';
import { SkeletonRows, ErrorState, EmptyState } from '../../components/ui/states';
import { MentionTextarea, CcSelect, NotesButton, MentionText } from '../../components/mentions';
import { useDirectory, addWatchers, notifyWatchers, truncate } from '../../lib/mentions';
import { useRoleContext } from '../../contexts/RoleContext';
import { useNotifications } from '../../contexts/NotificationsContext';
import type { Database } from '../../lib/database.types';

type FlagRow = Database['public']['Tables']['anomaly_flags']['Row'];
type Severity = FlagRow['severity'];
type Status = FlagRow['status'];

const SEV_CFG: Record<Severity, { label: string; bg: string; color: string; rank: number }> = {
  critical: { label: 'Critical', bg: '#FEE2E2', color: '#DC2626', rank: 0 },
  warning:  { label: 'Warning',  bg: '#FEF3C7', color: '#D97706', rank: 1 },
  watch:    { label: 'Watch',    bg: '#DBEAFE', color: '#2563EB', rank: 2 },
};

const SOURCE_LABEL: Record<string, string> = {
  predictive_qc: 'Predictive QC',
  material_recon: 'Material Reconciliation',
  predictive_maint: 'Predictive Maintenance',
  throughput: 'Throughput',
  demand: 'Demand & Procurement',
  margin: 'Margin & Pricing',
  receivables: 'Receivables & Credit',
};

function fmtValue(v: number | null, unit: string | null): string | null {
  if (v == null) return null;
  if (unit === 'INR') return `₹ ${Number(v).toLocaleString('en-IN')}`;
  if (unit === 'MT') return `${v} MT`;
  if (unit === 'hours') return `${v} hrs`;
  return String(v);
}

export function AnomalyOperationsCenter() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const { activeProfile } = useRoleContext();
  const { addNotification } = useNotifications();
  const people = useDirectory();
  const { rows, isLoading, isError, refetch, update } = useTable<'anomaly_flags'>('anomaly_flags', {
    orderBy: 'created_at',
  });

  const [statusFilter, setStatusFilter] = useState<'open' | 'resolved' | 'all'>('open');
  const [plantFilter, setPlantFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');

  // Reason capture for resolve/dismiss (the §5.4 feedback signal).
  const [reasonFor, setReasonFor] = useState<{ id: string; action: 'resolved' | 'dismissed' } | null>(null);
  const [reasonText, setReasonText] = useState('');
  const [reasonMentions, setReasonMentions] = useState<string[]>([]);
  const [reasonCc, setReasonCc] = useState<string[]>([]);

  const plants = useMemo(() => [...new Set(rows.map(r => r.plant).filter(Boolean))] as string[], [rows]);
  const sources = useMemo(() => [...new Set(rows.map(r => r.source_app))], [rows]);

  const counts = useMemo(() => {
    const open = rows.filter(r => r.status === 'open' || r.status === 'acknowledged');
    return {
      critical: open.filter(r => r.severity === 'critical').length,
      warning: open.filter(r => r.severity === 'warning').length,
      watch: open.filter(r => r.severity === 'watch').length,
      resolved: rows.filter(r => r.status === 'resolved' || r.status === 'dismissed').length,
    };
  }, [rows]);

  const visible = useMemo(() => {
    return rows
      .filter(r => {
        if (statusFilter === 'open') return r.status === 'open' || r.status === 'acknowledged';
        if (statusFilter === 'resolved') return r.status === 'resolved' || r.status === 'dismissed';
        return true;
      })
      .filter(r => plantFilter === 'all' || r.plant === plantFilter)
      .filter(r => sourceFilter === 'all' || r.source_app === sourceFilter)
      .sort((a, b) => {
        const s = SEV_CFG[a.severity].rank - SEV_CFG[b.severity].rank;
        if (s !== 0) return s;
        return (b.created_at || '').localeCompare(a.created_at || '');
      });
  }, [rows, statusFilter, plantFilter, sourceFilter]);

  async function setStatus(id: string, status: Status, resolution_reason?: string) {
    try {
      await update.mutateAsync({
        id,
        values: {
          status,
          ...(resolution_reason !== undefined ? { resolution_reason } : {}),
          ...(status === 'resolved' || status === 'dismissed' ? { resolved_at: new Date().toISOString() } : {}),
        },
      });
      toast.success(t('anomalyCenter.toast_flag_status', { status }));
    } catch (e) {
      toast.error(t('anomalyCenter.toast_update_failed', { error: e instanceof Error ? e.message : String(e) }));
    }
  }

  async function submitReason() {
    if (!reasonFor || !reasonText.trim()) return;
    const flag = rows.find((r) => r.id === reasonFor.id);
    const text = reasonText.trim();
    const action = reasonFor.action;
    await setStatus(reasonFor.id, action, text);

    // Tagged / CC'd people watch this flag and get notified of the change.
    const ref = { entityType: 'anomaly', entityId: reasonFor.id, entityLabel: flag?.title ?? 'Anomaly flag', route: '/dashboard/anomaly-center' };
    const actor = { id: activeProfile.id, name: activeProfile.name, role: activeProfile.roleLabel };
    const ccPeople = people.filter((p) => reasonCc.includes(p.id));
    const mPeople = people.filter((p) => reasonMentions.includes(p.id));
    if (ccPeople.length) await addWatchers(ref, ccPeople.map((p) => ({ id: p.id, name: p.name })), 'cc', actor.id);
    if (mPeople.length) await addWatchers(ref, mPeople.map((p) => ({ id: p.id, name: p.name })), 'mention', actor.id);
    await notifyWatchers({
      ref,
      actor,
      title: t('anomalyCenter.notif_title', { name: actor.name, action }),
      body: `${ref.entityLabel} — “${truncate(text)}”`,
      type: action === 'resolved' ? 'info' : 'info',
      addNotification,
      extraIds: [...reasonMentions, ...reasonCc],
    });

    setReasonFor(null);
    setReasonText('');
    setReasonMentions([]);
    setReasonCc([]);
  }

  return (
    <>
      {/* Severity summary */}
      <div className="grid grid-cols-12 gap-5 mb-5">
        {(['critical', 'warning', 'watch'] as Severity[]).map(sev => (
          <div key={sev} className="col-span-12 lg:col-span-3 card p-5">
            <div className="text-[11px] text-slate-500 uppercase tracking-wider">{t(`anomalyCenter.sev_${sev}`)}</div>
            <div className="text-[28px] font-extrabold mt-1 num" style={{ color: SEV_CFG[sev].color }}>{counts[sev]}</div>
            <div className="text-[11px] text-slate-500 mt-1">{t('anomalyCenter.open_flags')}</div>
          </div>
        ))}
        <div className="col-span-12 lg:col-span-3 card p-5">
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">{t('anomalyCenter.resolved_dismissed')}</div>
          <div className="text-[28px] font-extrabold mt-1 num text-green-600">{counts.resolved}</div>
          <div className="text-[11px] text-slate-500 mt-1">{t('anomalyCenter.cleared_total')}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="card2 p-4 mb-5 flex flex-wrap items-center gap-2">
        {(['open', 'resolved', 'all'] as const).map(s => (
          <button key={s} onClick={() => setStatusFilter(s)} className={`chip${statusFilter === s ? ' active' : ''}`} style={{ textTransform: 'capitalize' }}>{t(`anomalyCenter.filter_${s}`)}</button>
        ))}
        <div className="w-px h-5 bg-slate-200 mx-1" />
        <select value={plantFilter} onChange={e => setPlantFilter(e.target.value)} className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-full text-sm focus:outline-none">
          <option value="all">{t('anomalyCenter.all_plants')}</option>
          {plants.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)} className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-full text-sm focus:outline-none">
          <option value="all">{t('anomalyCenter.all_sources')}</option>
          {sources.map(s => <option key={s} value={s}>{t(`anomalyCenter.source_${s}`, { defaultValue: SOURCE_LABEL[s] || s })}</option>)}
        </select>
        <div className="flex-1" />
        <span className="text-xs text-slate-500">{t('anomalyCenter.count_shown', { count: visible.length })}</span>
      </div>

      {/* Feed */}
      {isLoading ? (
        <div className="card2 p-5"><SkeletonRows rows={6} /></div>
      ) : isError ? (
        <div className="card2 p-5"><ErrorState title={t('anomalyCenter.error_load')} onRetry={() => refetch()} /></div>
      ) : visible.length === 0 ? (
        <div className="card2 p-5"><EmptyState title={t('anomalyCenter.empty_title')} message={t('anomalyCenter.empty_message')} /></div>
      ) : (
        <div className="space-y-3">
          {visible.map(f => {
            const cfg = SEV_CFG[f.severity];
            const val = fmtValue(f.value_at_stake, f.value_unit);
            const isOpen = f.status === 'open' || f.status === 'acknowledged';
            return (
              <div key={f.id} className="card2 p-5" style={{ borderLeft: `3px solid ${cfg.color}` }}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="badge" style={{ background: cfg.bg, color: cfg.color, fontWeight: 700 }}>{t(`anomalyCenter.sev_${f.severity}`)}</span>
                      <span className="text-xs text-slate-500">{t(`anomalyCenter.source_${f.source_app}`, { defaultValue: SOURCE_LABEL[f.source_app] || f.source_app })}</span>
                      {f.plant && <span className="text-xs text-slate-400">· {f.plant}</span>}
                      {f.entity_label && <span className="text-xs text-slate-400">· {f.entity_label}</span>}
                      {f.status === 'acknowledged' && <span className="badge" style={{ background: '#EDE9FE', color: '#7C3AED' }}>{t('anomalyCenter.status_acknowledged')}</span>}
                      {f.status === 'resolved' && <span className="badge" style={{ background: '#DCFCE7', color: '#16A34A' }}>{t('anomalyCenter.status_resolved')}</span>}
                      {f.status === 'dismissed' && <span className="badge" style={{ background: '#F1F5F9', color: '#94A3B8' }}>{t('anomalyCenter.status_dismissed')}</span>}
                    </div>
                    <div className="text-sm font-bold text-slate-800">{f.title}</div>
                    {f.evidence && <div className="text-xs text-slate-500 mt-1">{f.evidence}</div>}
                    {f.recommended_action && (
                      <div className="text-xs mt-2 px-3 py-2 rounded-lg bg-slate-50 border border-slate-100">
                        <span className="font-semibold text-slate-600">{t('anomalyCenter.recommended_label')} </span>
                        <span className="text-slate-600">{f.recommended_action}</span>
                      </div>
                    )}
                    {f.resolution_reason && (
                      <div className="text-[11px] text-slate-400 mt-2">{t('anomalyCenter.reason_label')} <MentionText text={f.resolution_reason} /></div>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    {val && <div className="text-sm font-bold num text-slate-700">{val}</div>}
                    {f.confidence != null && <div className="text-[11px] text-slate-400">{t('anomalyCenter.confidence', { pct: Math.round(f.confidence * 100) })}</div>}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 mt-3 flex-wrap">
                  {f.route && (
                    <button onClick={() => navigate(f.route!)} className="chip hover:bg-slate-200">{t('anomalyCenter.open_source')}</button>
                  )}
                  <NotesButton entityType="anomaly" entityId={f.id} entityLabel={f.title} route="/anomaly-center" />
                  {isOpen && (
                    <>
                      {f.status !== 'acknowledged' && (
                        <button onClick={() => setStatus(f.id, 'acknowledged')} className="chip hover:bg-slate-200">{t('anomalyCenter.acknowledge')}</button>
                      )}
                      <button onClick={() => { setReasonFor({ id: f.id, action: 'resolved' }); setReasonText(''); }} className="chip hover:bg-green-100 text-green-700">{t('anomalyCenter.resolve')}</button>
                      <button onClick={() => { setReasonFor({ id: f.id, action: 'dismissed' }); setReasonText(''); }} className="chip hover:bg-slate-200 text-slate-500">{t('anomalyCenter.dismiss')}</button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Reason capture modal (feedback signal) */}
      {reasonFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(4px)' }} onClick={e => { if (e.target === e.currentTarget) setReasonFor(null); }}>
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-6">
            <div className="text-lg font-bold mb-1">{reasonFor.action === 'resolved' ? t('anomalyCenter.modal_resolve_title') : t('anomalyCenter.modal_dismiss_title')}</div>
            <div className="text-xs text-slate-500 mb-4">
              {t('anomalyCenter.modal_hint')}
            </div>
            <MentionTextarea
              value={reasonText}
              onChange={setReasonText}
              onMentionsChange={setReasonMentions}
              placeholder={reasonFor.action === 'resolved' ? t('anomalyCenter.placeholder_resolve') : t('anomalyCenter.placeholder_dismiss')}
              style={{ minHeight: 90 }}
              autoFocus
            />
            <div className="mt-3">
              <CcSelect value={reasonCc} onChange={setReasonCc} label={t('anomalyCenter.also_notify_cc')} excludeIds={[activeProfile.id]} />
            </div>
            <div className="flex gap-3 mt-4">
              <button onClick={() => setReasonFor(null)} className="btn-ghost rounded-[10px] flex-1 py-2.5 font-semibold text-sm">{t('anomalyCenter.cancel')}</button>
              <button onClick={submitReason} disabled={!reasonText.trim()} className="btn-accent rounded-[10px] flex-1 py-2.5 font-semibold text-sm" style={{ opacity: reasonText.trim() ? 1 : 0.5 }}>
                {reasonFor.action === 'resolved' ? t('anomalyCenter.confirm_resolve') : t('anomalyCenter.confirm_dismiss')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
