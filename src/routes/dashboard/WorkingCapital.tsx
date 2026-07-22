import React from 'react';
import { useTranslation } from 'react-i18next';
import { Wallet, Scale, Hourglass, TrendingUp } from 'lucide-react';
import { useOverviewKPIs, useAnalyticsKPIs, fmtINR } from '../../hooks/useBusyData';
import { KpiInfoButton } from '../../components/KpiInfoButton';
import { SkeletonRows } from '../../components/ui/states';
import { StatCard, SectionCard } from '../../components/v2';

export function WorkingCapital() {
  const { t } = useTranslation();
  const { data: kpis, isLoading: l1 } = useOverviewKPIs();
  const { data: a, isLoading: l2 } = useAnalyticsKPIs();

  if (l1 || l2 || !a || !kpis) {
    return <div className="card2 p-5"><SkeletonRows rows={6} /></div>;
  }

  const debtors = kpis.debtorsOutstanding ?? 0;
  const creditors = a.creditorsOutstanding ?? 0;
  const nwc = a.netWorkingCapital ?? debtors - creditors;
  const ccc = a.cashConversionCycle ?? 0;

  // Forward cash projection: weight receivables by collectibility (older = less
  // likely to land soon), net of payables due. A simple, transparent model.
  const ag = a.overdueAging;
  const collectible =
    ag.d1_30 * 0.95 + ag.d31_60 * 0.8 + ag.d61_90 * 0.6 + ag.d90plus * 0.3;
  const payableDue = ag.c1_30 + ag.c31_60 * 0.9 + ag.c61_90 * 0.8 + ag.c90plus * 0.6;
  const projectedCash = collectible - payableDue;

  return (
    <>
      <div className="grid grid-cols-12 gap-4 mb-4">
        <div className="col-span-12 sm:col-span-6 lg:col-span-3 relative">
          <KpiInfoButton info={{ title: 'Projected cash position', what: 'Forward cash from collectible receivables (weighted by ageing) net of payables coming due. Turns the ledger into a forward-looking picture.', source: 'Derived', note: 'Receivable/payable ageing buckets from analytics KPIs, weighted by collectibility.' }} />
          <StatCard className="h-full" icon={<Wallet />}
            tone={projectedCash >= 0 ? 'green' : 'red'} valueTone={projectedCash >= 0 ? 'green' : 'red'}
            label={t('workingCapital.projectedCashPosition')}
            value={fmtINR(projectedCash)}
            caption={t('workingCapital.collectibleMinusPayables')} />
        </div>
        <StatCard className="col-span-12 sm:col-span-6 lg:col-span-3" icon={<Scale />}
          tone={nwc >= 0 ? 'green' : 'red'} valueTone={nwc >= 0 ? 'green' : 'red'}
          label={t('workingCapital.netWorkingCapital')}
          value={fmtINR(nwc)}
          caption={t('workingCapital.debtorsMinusCreditors')} />
        <StatCard className="col-span-12 sm:col-span-6 lg:col-span-3" icon={<Hourglass />}
          tone={ccc <= 0 ? 'green' : 'amber'} valueTone={ccc <= 0 ? 'green' : 'amber'}
          label={t('workingCapital.cashConversionCycle')}
          value={`${ccc.toFixed(0)} d`}
          caption={ccc <= 0 ? t('workingCapital.cashPositiveSub') : t('workingCapital.daysCashTiedUp')} />
        <StatCard className="col-span-12 sm:col-span-6 lg:col-span-3" icon={<TrendingUp />} tone="blue"
          label={t('workingCapital.dsoDpo')}
          value={`${a.dso.toFixed(0)} / ${a.dpo.toFixed(0)} d`}
          caption={t('workingCapital.receivableVsPayableDays')} />
      </div>

      <div className="grid grid-cols-12 gap-4 mb-4">
        <SectionCard className="col-span-12 lg:col-span-6" title={t('workingCapital.receivablesAgeing')}>
          {([[t('workingCapital.ageing1_30'), ag.d1_30], [t('workingCapital.ageing31_60'), ag.d31_60], [t('workingCapital.ageing61_90'), ag.d61_90], [t('workingCapital.ageing90plus'), ag.d90plus]] as [string, number][]).map(([label, v], i) => {
            const max = Math.max(ag.d1_30, ag.d31_60, ag.d61_90, ag.d90plus, 1);
            const colors = ['#16A34A', '#D97706', '#EA580C', '#DC2626'];
            return (
              <div key={label} className="mb-2.5">
                <div className="flex justify-between text-xs mb-1"><span className="text-slate-500">{label}</span><span className="font-semibold num">{fmtINR(v)}</span></div>
                <div className="progress" style={{ height: 8 }}><div style={{ width: `${(v / max) * 100}%`, background: colors[i] }} /></div>
              </div>
            );
          })}
        </SectionCard>
        <SectionCard className="col-span-12 lg:col-span-6" title={t('workingCapital.position')}>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-slate-500">{t('workingCapital.debtorsOutstanding')}</span><span className="font-semibold num">{fmtINR(debtors)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">{t('workingCapital.creditorsOutstanding')}</span><span className="font-semibold num">{fmtINR(creditors)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">{t('workingCapital.revenueVsCashGap')}</span><span className="font-semibold num">{fmtINR(a.revenueReceiptsGap ?? 0)}</span></div>
            <div className="flex justify-between border-t pt-2 mt-2"><span className="font-semibold">{t('workingCapital.netWorkingCapital')}</span><span className="font-bold num" style={{ color: nwc >= 0 ? '#16A34A' : '#DC2626' }}>{fmtINR(nwc)}</span></div>
          </div>
          <div className="text-[11px] text-slate-400 mt-4">
            {t('workingCapital.cccFormula')} {ccc <= 0 ? t('workingCapital.cccNegative') : t('workingCapital.cccPositive')}
          </div>
        </SectionCard>
      </div>
    </>
  );
}
