import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { useQuery } from '@tanstack/react-query';
import { SkeletonRows, ErrorState, EmptyState } from '../../components/ui/states';
import { KpiInfoButton } from '../../components/KpiInfoButton';
import { computeBatchCost, DEFAULT_COST_CONFIG } from '../../lib/algorithms/costEngine';
import type { Database } from '../../lib/database.types';

type BatchRow = Database['public']['Tables']['active_batches']['Row'] & { plants?: { name: string | null } | null };

const MT_PER_DRUM = 0.24;

interface PlantStats {
  plant: string;
  batches: number;
  totalOutputMT: number;
  avgCycleHrs: number;
  offSpecRate: number; // 0..1 (flagged / total)
  avgCostPerMT: number;
}

function fmtINR(v: number): string {
  return `₹ ${Math.round(v).toLocaleString('en-IN')}`;
}

export function Benchmarking() {
  const navigate = useNavigate();
  const { t } = useTranslation();

  const { data, isLoading, isError, refetch } = useQuery<BatchRow[]>({
    queryKey: ['benchmark-batches'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('active_batches')
        .select('*, plants(name)')
        .in('status', ['closed', 'flagged'])
        .returns<BatchRow[]>();
      if (error) throw error;
      return data ?? [];
    },
  });

  const stats = useMemo<PlantStats[]>(() => {
    const byPlant = new Map<string, BatchRow[]>();
    for (const b of data ?? []) {
      const key = b.plants?.name || 'Unassigned';
      const arr = byPlant.get(key) ?? [];
      arr.push(b);
      byPlant.set(key, arr);
    }
    const rows: PlantStats[] = [];
    for (const [plant, batches] of byPlant) {
      let outputMT = 0, cycleSum = 0, cycleN = 0, costPerMTSum = 0, costPerMTN = 0, flagged = 0;
      for (const b of batches) {
        const out = (b.total_drums ?? 0) * MT_PER_DRUM;
        outputMT += out;
        if (b.status === 'flagged') flagged++;
        if (b.started_at && b.closed_at) {
          cycleSum += Math.max(0, (new Date(b.closed_at).getTime() - new Date(b.started_at).getTime()) / 3.6e6);
          cycleN++;
        }
        if (out > 0) {
          const reactorHours = b.started_at && b.closed_at
            ? Math.max(0, (new Date(b.closed_at).getTime() - new Date(b.started_at).getTime()) / 3.6e6) : 0;
          const cost = computeBatchCost({
            paraffinWeightKg: b.paraffin_weight ?? 0, cl2QtyMT: b.hcl_quantity ?? 0, reactorHours, outputMT: out,
          }, DEFAULT_COST_CONFIG);
          costPerMTSum += cost.costPerMT;
          costPerMTN++;
        }
      }
      rows.push({
        plant,
        batches: batches.length,
        totalOutputMT: outputMT,
        avgCycleHrs: cycleN ? cycleSum / cycleN : 0,
        offSpecRate: batches.length ? flagged / batches.length : 0,
        avgCostPerMT: costPerMTN ? costPerMTSum / costPerMTN : 0,
      });
    }
    // Rank by lowest cost/MT (cheapest, most efficient first).
    return rows.sort((a, b) => (a.avgCostPerMT || Infinity) - (b.avgCostPerMT || Infinity));
  }, [data]);

  const best = stats.find(s => s.avgCostPerMT > 0);

  return (
    <>
      <div className="grid grid-cols-12 gap-5 mb-5">
        <div className="col-span-12 lg:col-span-4 card p-5" style={{ position: 'relative' }}>
          <KpiInfoButton info={{ title: 'Plant league table', what: 'Ranks the plants against each other on the metrics that drive cost and reliability, so best practice at one plant becomes visible at the others.', source: 'Derived', note: 'Grouped from closed/flagged active_batches; cost/MT from computeBatchCost().' }} />
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">{t('benchmarking.plantsCompared')}</div>
          <div className="text-[28px] font-extrabold mt-1 num">{stats.length}</div>
        </div>
        <div className="col-span-12 lg:col-span-4 card p-5">
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">{t('benchmarking.lowestCostPerMT')}</div>
          <div className="text-[28px] font-extrabold mt-1 num text-green-600">{best ? fmtINR(best.avgCostPerMT) : '—'}</div>
          <div className="text-[11px] text-slate-500 mt-1">{best ? best.plant : t('benchmarking.noDataYet')}</div>
        </div>
        <div className="col-span-12 lg:col-span-4 card p-5">
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">{t('benchmarking.totalOutput')}</div>
          <div className="text-[28px] font-extrabold mt-1 num">{stats.reduce((s, p) => s + p.totalOutputMT, 0).toFixed(0)} MT</div>
        </div>
      </div>

      <div className="card2 p-6">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
          <div>
            <div className="text-base font-bold font-heading">{t('benchmarking.title')}</div>
            <div className="text-xs text-slate-500">{t('benchmarking.subtitle')}</div>
          </div>
        </div>
        {isLoading ? (
          <SkeletonRows rows={5} />
        ) : isError ? (
          <ErrorState title={t('benchmarking.loadError')} onRetry={() => refetch()} />
        ) : stats.length === 0 ? (
          <EmptyState title={t('benchmarking.emptyTitle')} message={t('benchmarking.emptyMessage')} />
        ) : (
          <div className="overflow-x-auto scroll-x">
            <table className="dt2">
              <thead>
                <tr>
                  <th className="num">#</th><th>{t('benchmarking.colPlant')}</th><th className="num">{t('benchmarking.colBatches')}</th>
                  <th className="num">{t('benchmarking.colOutput')}</th><th className="num">{t('benchmarking.colAvgCycle')}</th>
                  <th className="num">{t('benchmarking.colOffSpec')}</th><th className="num">{t('benchmarking.colCostPerMT')}</th><th></th>
                </tr>
              </thead>
              <tbody>
                {stats.map((s, i) => (
                  <tr key={s.plant}>
                    <td className="num font-bold text-slate-400">{i + 1}</td>
                    <td className="font-semibold">{s.plant}</td>
                    <td className="num">{s.batches}</td>
                    <td className="num">{s.totalOutputMT.toFixed(1)}</td>
                    <td className="num text-slate-500">{s.avgCycleHrs > 0 ? s.avgCycleHrs.toFixed(1) : '—'}</td>
                    <td className="num">
                      <span style={{ color: s.offSpecRate > 0.1 ? '#DC2626' : s.offSpecRate > 0 ? '#D97706' : '#16A34A', fontWeight: 600 }}>
                        {(s.offSpecRate * 100).toFixed(0)}%
                      </span>
                    </td>
                    <td className="num font-bold">{s.avgCostPerMT > 0 ? fmtINR(s.avgCostPerMT) : '—'}</td>
                    <td><button className="chip hover:bg-slate-200" onClick={() => navigate('/dashboard/batches')}>{t('benchmarking.batchesLink')}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
