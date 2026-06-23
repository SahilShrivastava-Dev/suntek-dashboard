import React from 'react';
import { useOverviewKPIs, useAnalyticsKPIs, fmtINR } from '../../hooks/useBusyData';
import { KpiInfoButton } from '../../components/KpiInfoButton';
import { SkeletonRows } from '../../components/ui/states';

function Stat({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="card p-5">
      <div className="text-[11px] text-slate-500 uppercase tracking-wider">{label}</div>
      <div className="text-[28px] font-extrabold mt-1 num" style={color ? { color } : undefined}>{value}</div>
      {sub && <div className="text-[11px] text-slate-500 mt-1">{sub}</div>}
    </div>
  );
}

export function WorkingCapital() {
  const { data: kpis, isLoading: l1 } = useOverviewKPIs();
  const { data: a, isLoading: l2 } = useAnalyticsKPIs();

  if (l1 || l2 || !a || !kpis) {
    return <div className="card p-5"><SkeletonRows rows={6} /></div>;
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
      <div className="grid grid-cols-12 gap-5 mb-5" style={{ display: 'grid', gridTemplateColumns: 'repeat(12,1fr)' }}>
        <div className="col-span-12 lg:col-span-3" style={{ gridColumn: 'span 3' }}>
          <div className="card p-5" style={{ position: 'relative' }}>
            <KpiInfoButton info={{ title: 'Projected cash position', what: 'Forward cash from collectible receivables (weighted by ageing) net of payables coming due. Turns the ledger into a forward-looking picture.', source: 'Derived', note: 'Receivable/payable ageing buckets from analytics KPIs, weighted by collectibility.' }} />
            <div className="text-[11px] text-slate-500 uppercase tracking-wider">Projected cash position</div>
            <div className="text-[28px] font-extrabold mt-1 num" style={{ color: projectedCash >= 0 ? '#16A34A' : '#DC2626' }}>{fmtINR(projectedCash)}</div>
            <div className="text-[11px] text-slate-500 mt-1">collectible − payables due</div>
          </div>
        </div>
        <div style={{ gridColumn: 'span 3' }}><Stat label="Net working capital" value={fmtINR(nwc)} sub="debtors − creditors" color={nwc >= 0 ? '#16A34A' : '#DC2626'} /></div>
        <div style={{ gridColumn: 'span 3' }}><Stat label="Cash conversion cycle" value={`${ccc.toFixed(0)} d`} sub={ccc <= 0 ? 'cash-positive — collect before you pay' : 'days cash is tied up'} color={ccc <= 0 ? '#16A34A' : '#D97706'} /></div>
        <div style={{ gridColumn: 'span 3' }}><Stat label="DSO / DPO" value={`${a.dso.toFixed(0)} / ${a.dpo.toFixed(0)} d`} sub="receivable vs payable days" /></div>
      </div>

      <div className="grid grid-cols-12 gap-5 mb-5">
        <div className="col-span-12 lg:col-span-6 card p-6">
          <div className="text-base font-bold mb-3">Receivables ageing</div>
          {([['1–30 d', ag.d1_30], ['31–60 d', ag.d31_60], ['61–90 d', ag.d61_90], ['90+ d', ag.d90plus]] as [string, number][]).map(([label, v], i) => {
            const max = Math.max(ag.d1_30, ag.d31_60, ag.d61_90, ag.d90plus, 1);
            const colors = ['#16A34A', '#D97706', '#EA580C', '#DC2626'];
            return (
              <div key={label} className="mb-2.5">
                <div className="flex justify-between text-xs mb-1"><span className="text-slate-500">{label}</span><span className="font-semibold num">{fmtINR(v)}</span></div>
                <div className="progress" style={{ height: 8 }}><div style={{ width: `${(v / max) * 100}%`, background: colors[i] }} /></div>
              </div>
            );
          })}
        </div>
        <div className="col-span-12 lg:col-span-6 card p-6">
          <div className="text-base font-bold mb-3">Position</div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-slate-500">Debtors outstanding</span><span className="font-semibold num">{fmtINR(debtors)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Creditors outstanding</span><span className="font-semibold num">{fmtINR(creditors)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Revenue vs cash gap</span><span className="font-semibold num">{fmtINR(a.revenueReceiptsGap ?? 0)}</span></div>
            <div className="flex justify-between border-t pt-2 mt-2"><span className="font-semibold">Net working capital</span><span className="font-bold num" style={{ color: nwc >= 0 ? '#16A34A' : '#DC2626' }}>{fmtINR(nwc)}</span></div>
          </div>
          <div className="text-[11px] text-slate-400 mt-4">
            Cash-conversion cycle = inventory days + receivable days − payable days. {ccc <= 0 ? 'Negative is good — you collect before you pay.' : 'Lower frees up trapped cash.'}
          </div>
        </div>
      </div>
    </>
  );
}
