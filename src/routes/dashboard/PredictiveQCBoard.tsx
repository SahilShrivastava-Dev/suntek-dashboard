import React, { useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { useQuery } from '@tanstack/react-query';
import { LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts';
import { SkeletonRows, ErrorState, EmptyState } from '../../components/ui/states';
import { KpiInfoButton } from '../../components/KpiInfoButton';
import { NotesButton } from '../../components/mentions';
import type { Database } from '../../lib/database.types';

type BatchRow = Database['public']['Tables']['active_batches']['Row'] & { plants?: { name: string | null } | null };
type ReadingRow = Database['public']['Tables']['batch_readings']['Row'];

const GOLDEN_POINTS = 12;
const TOL_GREEN = 3; // % within target
const TOL_AMBER = 5;

/** The proven healthy gravity trajectory for a grade (saturating rise to target). */
function goldenCurve(grade: number, points = GOLDEN_POINTS): number[] {
  const start = 1000;
  return Array.from({ length: points }, (_, i) => {
    const x = i / (points - 1);
    return Math.round(start + (grade - start) * (1 - Math.exp(-3 * x)));
  });
}

interface BatchProjection {
  batch: BatchRow;
  grade: number;
  golden: number[];
  live: number[];
  projected: number;
  devPct: number;
  status: 'green' | 'amber' | 'red';
  chart: { i: number; golden: number; live: number | null }[];
}

const STATUS_CFG = {
  green: { label: 'On track', color: '#16A34A', bg: '#DCFCE7' },
  amber: { label: 'Drifting', color: '#D97706', bg: '#FEF3C7' },
  red:   { label: 'Off-spec risk', color: '#DC2626', bg: '#FEE2E2' },
};

export function PredictiveQCBoard() {
  const { data, isLoading, isError, refetch } = useQuery<{ batches: BatchRow[]; readings: ReadingRow[] }>({
    queryKey: ['predictive-qc'],
    queryFn: async () => {
      const { data: batches, error: be } = await supabase
        .from('active_batches').select('*, plants(name)').eq('status', 'active').returns<BatchRow[]>();
      if (be) throw be;
      const ids = (batches ?? []).map(b => b.id);
      let readings: ReadingRow[] = [];
      if (ids.length) {
        const { data: rd } = await supabase
          .from('batch_readings').select('*').in('batch_id', ids)
          .order('timestamp', { ascending: true }).returns<ReadingRow[]>();
        readings = rd ?? [];
      }
      return { batches: batches ?? [], readings };
    },
  });

  const projections = useMemo<BatchProjection[]>(() => {
    const batches = data?.batches ?? [];
    const readings = data?.readings ?? [];
    return batches.map(b => {
      const grade = parseInt(b.recipe || '', 10) || b.final_gravity || 1400;
      const golden = goldenCurve(grade);
      const live = readings
        .filter(r => r.batch_id === b.id && r.cp_gravity != null)
        .map(r => r.cp_gravity as number);
      // Project final by drift vs the golden curve at the same points.
      const goldenPartial = golden.slice(0, live.length);
      const ratios = live.map((v, i) => (goldenPartial[i] ? v / goldenPartial[i] : 1));
      const driftFactor = ratios.length ? ratios.reduce((a, b) => a + b, 0) / ratios.length : 1;
      const projected = Math.round(grade * driftFactor);
      const devPct = (driftFactor - 1) * 100;
      const status: BatchProjection['status'] =
        Math.abs(devPct) <= TOL_GREEN ? 'green' : Math.abs(devPct) <= TOL_AMBER ? 'amber' : 'red';
      const chart = golden.map((g, i) => ({ i: i + 1, golden: g, live: i < live.length ? live[i] : null }));
      return { batch: b, grade, golden, live, projected, devPct, status, chart };
    });
  }, [data]);

  const counts = useMemo(() => ({
    green: projections.filter(p => p.status === 'green').length,
    amber: projections.filter(p => p.status === 'amber').length,
    red: projections.filter(p => p.status === 'red').length,
  }), [projections]);

  return (
    <>
      <div className="grid grid-cols-12 gap-5 mb-5">
        <div className="col-span-12 lg:col-span-4 card p-5" style={{ position: 'relative' }}>
          <KpiInfoButton info={{ title: 'Live Predictive QC', what: 'Every running batch projected to where it will land — its live gravity curve against the proven golden-batch trajectory for that grade, hours before closure.', source: 'Derived', note: 'Golden curve per grade; projection = drift vs golden carried to the endpoint. Detector 4.1 raises flags into the Anomaly Center.' }} />
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">Running batches</div>
          <div className="text-[28px] font-extrabold mt-1 num">{projections.length}</div>
        </div>
        <div className="col-span-12 lg:col-span-4 card p-5">
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">Projection status</div>
          <div className="flex items-center gap-3 mt-2">
            <span className="text-sm font-bold text-green-600">{counts.green} on track</span>
            <span className="text-sm font-bold text-amber-600">{counts.amber} drifting</span>
            <span className="text-sm font-bold text-red-600">{counts.red} at risk</span>
          </div>
        </div>
        <div className="col-span-12 lg:col-span-4 card p-5">
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">Golden-batch model</div>
          <div className="text-sm font-semibold mt-2 text-slate-600">Per-grade trajectory overlay</div>
          <div className="text-[11px] text-slate-500 mt-1">steer the live curve toward it</div>
        </div>
      </div>

      {isLoading ? (
        <div className="card p-5"><SkeletonRows rows={6} /></div>
      ) : isError ? (
        <div className="card p-5"><ErrorState title="Couldn't load running batches" onRetry={() => refetch()} /></div>
      ) : projections.length === 0 ? (
        <div className="card p-5"><EmptyState title="No running batches" message="Start a batch in the Batch Logger; its live gravity readings will plot against the golden curve here." /></div>
      ) : (
        <div className="grid grid-cols-12 gap-5">
          {projections.map(p => {
            const cfg = STATUS_CFG[p.status];
            return (
              <div key={p.batch.id} className="col-span-12 lg:col-span-6 card p-5" style={{ borderTop: `3px solid ${cfg.color}` }}>
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <div className="text-base font-bold">Batch {p.batch.batch_no}</div>
                    <div className="text-xs text-slate-500">{p.batch.plants?.name || '—'} · grade {p.grade} · {p.live.length} readings</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="badge" style={{ background: cfg.bg, color: cfg.color, fontWeight: 700 }}>{cfg.label}</span>
                    <NotesButton
                      entityType="active_batch"
                      entityId={p.batch.id}
                      entityLabel={`Batch ${p.batch.batch_no}${p.batch.plants?.name ? ' · ' + p.batch.plants.name : ''}`}
                      route="/dashboard/predictive-qc"
                    />
                  </div>
                </div>
                <div style={{ height: 160 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={p.chart} margin={{ top: 5, right: 8, bottom: 0, left: -18 }}>
                      <XAxis dataKey="i" tick={{ fontSize: 10 }} stroke="#cbd5e1" />
                      <YAxis domain={['dataMin - 30', 'dataMax + 30']} tick={{ fontSize: 10 }} stroke="#cbd5e1" />
                      <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                      <ReferenceLine y={p.grade} stroke="#94a3b8" strokeDasharray="4 4" />
                      <Line type="monotone" dataKey="golden" name="Golden" stroke="#94a3b8" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="live" name="Live" stroke={cfg.color} strokeWidth={2.5} dot={{ r: 2 }} connectNulls />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex items-center justify-between mt-2 text-xs">
                  <span className="text-slate-500">Projected final: <span className="font-bold num" style={{ color: cfg.color }}>{p.projected}</span> vs target {p.grade}</span>
                  <span className="font-semibold" style={{ color: cfg.color }}>{p.devPct >= 0 ? '+' : ''}{p.devPct.toFixed(1)}%</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
