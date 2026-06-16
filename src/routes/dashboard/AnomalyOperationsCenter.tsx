import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTable } from '../../hooks/useTable';
import { useToast } from '../../components/ui/toast';
import { SkeletonRows, ErrorState, EmptyState } from '../../components/ui/states';
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
  const navigate = useNavigate();
  const toast = useToast();
  const { rows, isLoading, isError, refetch, update } = useTable<'anomaly_flags'>('anomaly_flags', {
    orderBy: 'created_at',
  });

  const [statusFilter, setStatusFilter] = useState<'open' | 'resolved' | 'all'>('open');
  const [plantFilter, setPlantFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');

  // Reason capture for resolve/dismiss (the §5.4 feedback signal).
  const [reasonFor, setReasonFor] = useState<{ id: string; action: 'resolved' | 'dismissed' } | null>(null);
  const [reasonText, setReasonText] = useState('');

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
      toast.success(`Flag ${status}`);
    } catch (e) {
      toast.error(`Update failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function submitReason() {
    if (!reasonFor || !reasonText.trim()) return;
    setStatus(reasonFor.id, reasonFor.action, reasonText.trim());
    setReasonFor(null);
    setReasonText('');
  }

  return (
    <>
      {/* Severity summary */}
      <div className="grid grid-cols-12 gap-5 mb-5">
        {(['critical', 'warning', 'watch'] as Severity[]).map(sev => (
          <div key={sev} className="col-span-12 lg:col-span-3 card p-5">
            <div className="text-[11px] text-slate-500 uppercase tracking-wider">{SEV_CFG[sev].label}</div>
            <div className="text-[28px] font-extrabold mt-1 num" style={{ color: SEV_CFG[sev].color }}>{counts[sev]}</div>
            <div className="text-[11px] text-slate-500 mt-1">open flags</div>
          </div>
        ))}
        <div className="col-span-12 lg:col-span-3 card p-5">
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">Resolved / dismissed</div>
          <div className="text-[28px] font-extrabold mt-1 num text-green-600">{counts.resolved}</div>
          <div className="text-[11px] text-slate-500 mt-1">cleared total</div>
        </div>
      </div>

      {/* Filters */}
      <div className="card p-4 mb-5 flex flex-wrap items-center gap-2">
        {(['open', 'resolved', 'all'] as const).map(s => (
          <button key={s} onClick={() => setStatusFilter(s)} className={`chip${statusFilter === s ? ' active' : ''}`} style={{ textTransform: 'capitalize' }}>{s}</button>
        ))}
        <div className="w-px h-5 bg-slate-200 mx-1" />
        <select value={plantFilter} onChange={e => setPlantFilter(e.target.value)} className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-full text-sm focus:outline-none">
          <option value="all">All plants</option>
          {plants.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)} className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-full text-sm focus:outline-none">
          <option value="all">All sources</option>
          {sources.map(s => <option key={s} value={s}>{SOURCE_LABEL[s] || s}</option>)}
        </select>
        <div className="flex-1" />
        <span className="text-xs text-slate-500">{visible.length} shown</span>
      </div>

      {/* Feed */}
      {isLoading ? (
        <div className="card p-5"><SkeletonRows rows={6} /></div>
      ) : isError ? (
        <div className="card p-5"><ErrorState title="Couldn't load anomaly flags" onRetry={() => refetch()} /></div>
      ) : visible.length === 0 ? (
        <div className="card p-5"><EmptyState title="No anomalies match this view" message="Flags raised by the anomaly applications appear here, ranked by severity." /></div>
      ) : (
        <div className="space-y-3">
          {visible.map(f => {
            const cfg = SEV_CFG[f.severity];
            const val = fmtValue(f.value_at_stake, f.value_unit);
            const isOpen = f.status === 'open' || f.status === 'acknowledged';
            return (
              <div key={f.id} className="card p-5" style={{ borderLeft: `3px solid ${cfg.color}` }}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="badge" style={{ background: cfg.bg, color: cfg.color, fontWeight: 700 }}>{cfg.label}</span>
                      <span className="text-xs text-slate-500">{SOURCE_LABEL[f.source_app] || f.source_app}</span>
                      {f.plant && <span className="text-xs text-slate-400">· {f.plant}</span>}
                      {f.entity_label && <span className="text-xs text-slate-400">· {f.entity_label}</span>}
                      {f.status === 'acknowledged' && <span className="badge" style={{ background: '#EDE9FE', color: '#7C3AED' }}>Acknowledged</span>}
                      {f.status === 'resolved' && <span className="badge" style={{ background: '#DCFCE7', color: '#16A34A' }}>Resolved</span>}
                      {f.status === 'dismissed' && <span className="badge" style={{ background: '#F1F5F9', color: '#94A3B8' }}>Dismissed</span>}
                    </div>
                    <div className="text-sm font-bold text-slate-800">{f.title}</div>
                    {f.evidence && <div className="text-xs text-slate-500 mt-1">{f.evidence}</div>}
                    {f.recommended_action && (
                      <div className="text-xs mt-2 px-3 py-2 rounded-lg bg-slate-50 border border-slate-100">
                        <span className="font-semibold text-slate-600">Recommended: </span>
                        <span className="text-slate-600">{f.recommended_action}</span>
                      </div>
                    )}
                    {f.resolution_reason && (
                      <div className="text-[11px] text-slate-400 mt-2">Reason: {f.resolution_reason}</div>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    {val && <div className="text-sm font-bold num text-slate-700">{val}</div>}
                    {f.confidence != null && <div className="text-[11px] text-slate-400">conf {Math.round(f.confidence * 100)}%</div>}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 mt-3 flex-wrap">
                  {f.route && (
                    <button onClick={() => navigate(f.route!)} className="chip hover:bg-slate-200">Open source →</button>
                  )}
                  {isOpen && (
                    <>
                      {f.status !== 'acknowledged' && (
                        <button onClick={() => setStatus(f.id, 'acknowledged')} className="chip hover:bg-slate-200">Acknowledge</button>
                      )}
                      <button onClick={() => { setReasonFor({ id: f.id, action: 'resolved' }); setReasonText(''); }} className="chip hover:bg-green-100 text-green-700">Resolve</button>
                      <button onClick={() => { setReasonFor({ id: f.id, action: 'dismissed' }); setReasonText(''); }} className="chip hover:bg-slate-200 text-slate-500">Dismiss</button>
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
            <div className="text-lg font-bold mb-1">{reasonFor.action === 'resolved' ? 'Resolve flag' : 'Dismiss flag'}</div>
            <div className="text-xs text-slate-500 mb-4">
              Capture why — this tunes the detectors. Confirmed anomalies sharpen the models; dismissed false positives raise the threshold.
            </div>
            <textarea
              value={reasonText}
              onChange={e => setReasonText(e.target.value)}
              placeholder={reasonFor.action === 'resolved' ? 'What was the issue and how was it fixed?' : 'Why is this not a real anomaly?'}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-200 min-h-[90px]"
            />
            <div className="flex gap-3 mt-4">
              <button onClick={() => setReasonFor(null)} className="btn-ghost pill flex-1 py-2.5 font-semibold text-sm">Cancel</button>
              <button onClick={submitReason} disabled={!reasonText.trim()} className="btn-accent pill flex-1 py-2.5 font-semibold text-sm" style={{ opacity: reasonText.trim() ? 1 : 0.5 }}>
                Confirm {reasonFor.action === 'resolved' ? 'resolve' : 'dismiss'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
