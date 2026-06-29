import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { useQuery } from '@tanstack/react-query';
import { SkeletonRows, ErrorState, EmptyState } from '../../components/ui/states';
import { KpiInfoButton } from '../../components/KpiInfoButton';
import { computeBatchCost, DEFAULT_COST_CONFIG, type CostConfig } from '../../lib/algorithms/costEngine';
import type { Database } from '../../lib/database.types';

type BatchRow = Database['public']['Tables']['active_batches']['Row'] & { plants?: { name: string | null } | null };

const KG_PER_DRUM = 240;
const MT_PER_DRUM = KG_PER_DRUM / 1000;

const RATE_FIELDS: { key: keyof CostConfig; label: string; suffix: string }[] = [
  { key: 'paraffinRatePerKg', label: 'Paraffin (NP)', suffix: '₹/kg' },
  { key: 'cl2RatePerMT',      label: 'Chlorine (Cl₂)', suffix: '₹/MT' },
  { key: 'energyRatePerHour', label: 'Energy',         suffix: '₹/reactor-hr' },
  { key: 'labourPerMT',       label: 'Labour',         suffix: '₹/MT' },
  { key: 'overheadPct',       label: 'Overhead',       suffix: '%' },
];

function fmtINR(v: number): string {
  return `₹ ${Math.round(v).toLocaleString('en-IN')}`;
}

export function CostIntelligence() {
  const { t } = useTranslation();
  const [config, setConfig] = useState<CostConfig>({ ...DEFAULT_COST_CONFIG });

  const { data, isLoading, isError, refetch } = useQuery<BatchRow[]>({
    queryKey: ['cost-closed-batches'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('active_batches')
        .select('*, plants(name)')
        .eq('status', 'closed')
        .order('closed_at', { ascending: false })
        .returns<BatchRow[]>();
      if (error) throw error;
      return data ?? [];
    },
  });

  const costed = useMemo(() => {
    return (data ?? []).map(b => {
      const outputMT = (b.total_drums ?? 0) * MT_PER_DRUM;
      const reactorHours = b.started_at && b.closed_at
        ? Math.max(0, (new Date(b.closed_at).getTime() - new Date(b.started_at).getTime()) / 3.6e6)
        : 0;
      const cost = computeBatchCost({
        paraffinWeightKg: b.paraffin_weight ?? 0,
        cl2QtyMT: b.hcl_quantity ?? 0, // proxy: HCL output tracks Cl2 consumption until a dedicated column lands
        reactorHours,
        outputMT,
      }, config);
      return { batch: b, outputMT, reactorHours, cost };
    });
  }, [data, config]);

  const summary = useMemo(() => {
    const withOutput = costed.filter(c => c.outputMT > 0);
    const totalLanded = costed.reduce((s, c) => s + c.cost.landedCost, 0);
    const avgPerMT = withOutput.length
      ? withOutput.reduce((s, c) => s + c.cost.costPerMT, 0) / withOutput.length
      : 0;
    return { totalLanded, avgPerMT, count: costed.length };
  }, [costed]);

  function setRate(key: keyof CostConfig, value: string) {
    const n = parseFloat(value);
    setConfig(c => ({ ...c, [key]: Number.isFinite(n) ? n : 0 }));
  }

  return (
    <>
      {/* KPIs */}
      <div className="grid grid-cols-12 gap-5 mb-5">
        <div className="col-span-12 lg:col-span-4 card p-5" style={{ position: 'relative' }}>
          <KpiInfoButton info={{ title: 'Avg landed cost / MT', what: 'Mean true landed cost per MT across closed batches — material + labour + energy + overhead. The foundation for margin and pricing checks.', source: 'Derived', note: 'computeBatchCost() over closed active_batches with the rates set on the right.' }} />
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">{t('costIntel.kpiAvgLanded')}</div>
          <div className="text-[28px] font-extrabold mt-1 num">{summary.avgPerMT > 0 ? fmtINR(summary.avgPerMT) : '—'}</div>
          <div className="text-[11px] text-slate-500 mt-1">{t('costIntel.kpiAvgLandedSub')}</div>
        </div>
        <div className="col-span-12 lg:col-span-4 card p-5">
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">{t('costIntel.kpiTotalLanded')}</div>
          <div className="text-[28px] font-extrabold mt-1 num">{summary.totalLanded > 0 ? fmtINR(summary.totalLanded) : '—'}</div>
          <div className="text-[11px] text-slate-500 mt-1">{t('costIntel.kpiTotalLandedSub')}</div>
        </div>
        <div className="col-span-12 lg:col-span-4 card p-5">
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">{t('costIntel.kpiBatchesCosted')}</div>
          <div className="text-[28px] font-extrabold mt-1 num">{summary.count}</div>
          <div className="text-[11px] text-slate-500 mt-1">{t('costIntel.kpiBatchesCostedSub')}</div>
        </div>
      </div>

      {/* Rate config */}
      <div className="card p-5 mb-5">
        <div className="text-base font-bold mb-1">{t('costIntel.costRatesTitle')}</div>
        <div className="text-xs text-slate-500 mb-4">{t('costIntel.costRatesSub')}</div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {RATE_FIELDS.map(f => (
            <div key={f.key}>
              <div className="text-[11px] font-semibold text-slate-500 mb-1">{t(`costIntel.rate_${f.key}`)} <span className="text-slate-400">({f.suffix})</span></div>
              <input
                type="number"
                value={config[f.key]}
                onChange={e => setRate(f.key, e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-200"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Per-batch table */}
      <div className="card p-6">
        <div className="text-base font-bold mb-3">{t('costIntel.tableTitle')}</div>
        {isLoading ? (
          <SkeletonRows rows={6} />
        ) : isError ? (
          <ErrorState title={t('costIntel.errorLoad')} onRetry={() => refetch()} />
        ) : costed.length === 0 ? (
          <EmptyState title={t('costIntel.emptyTitle')} message={t('costIntel.emptyMessage')} />
        ) : (
          <div className="overflow-x-auto scroll-x">
            <table className="dt">
              <thead>
                <tr>
                  <th>{t('costIntel.colBatch')}</th><th>{t('costIntel.colPlant')}</th><th className="num">{t('costIntel.colOutput')}</th><th className="num">{t('costIntel.colReactorHrs')}</th>
                  <th className="num">{t('costIntel.colMaterial')}</th><th className="num">{t('costIntel.colLabour')}</th><th className="num">{t('costIntel.colEnergy')}</th>
                  <th className="num">{t('costIntel.colOverhead')}</th><th className="num">{t('costIntel.colLanded')}</th><th className="num">{t('costIntel.colCostPerMT')}</th>
                </tr>
              </thead>
              <tbody>
                {costed.map(({ batch, outputMT, reactorHours, cost }) => (
                  <tr key={batch.id}>
                    <td className="font-semibold">{batch.batch_no}</td>
                    <td className="text-slate-500">{batch.plants?.name || '—'}</td>
                    <td className="num">{outputMT.toFixed(1)}</td>
                    <td className="num text-slate-500">{reactorHours.toFixed(1)}</td>
                    <td className="num text-slate-500">{fmtINR(cost.materialCost)}</td>
                    <td className="num text-slate-500">{fmtINR(cost.labourCost)}</td>
                    <td className="num text-slate-500">{fmtINR(cost.energyCost)}</td>
                    <td className="num text-slate-500">{fmtINR(cost.overheadCost)}</td>
                    <td className="num font-bold">{fmtINR(cost.landedCost)}</td>
                    <td className="num font-semibold">{cost.costPerMT > 0 ? fmtINR(cost.costPerMT) : '—'}</td>
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
