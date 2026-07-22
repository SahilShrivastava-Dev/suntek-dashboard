import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useOverviewKPIs, useAnalyticsKPIs, useTopCustomers, fmtINR } from '../../hooks/useBusyData';
import { useToast } from '../../components/ui/toast';
import { KpiInfoButton } from '../../components/KpiInfoButton';
import { computeBatchCost, DEFAULT_COST_CONFIG, type CostConfig } from '../../lib/algorithms/costEngine';

// ── Daily digest ──────────────────────────────────────────────────────────────

function useDigest(): string[] {
  const { t } = useTranslation();
  const { data: kpis } = useOverviewKPIs();
  const { data: a } = useAnalyticsKPIs();
  return useMemo(() => {
    if (!kpis || !a) return [t('owner.digest.gathering')];
    const lines: string[] = [];
    lines.push(t('owner.digest.salesMtd', { sales: fmtINR(kpis.salesMTD ?? 0), margin: a.grossMarginPct?.toFixed(1) }));
    lines.push(t('owner.digest.debtors', { amount: fmtINR(kpis.debtorsOutstanding ?? 0), dso: a.dso?.toFixed(0) }));
    const overdue = (a.overdueAging?.d31_60 ?? 0) + (a.overdueAging?.d61_90 ?? 0) + (a.overdueAging?.d90plus ?? 0);
    if (overdue > 0) lines.push(t('owner.digest.overdue', { amount: fmtINR(overdue) }));
    const cccSuffix = a.cashConversionCycle <= 0 ? t('owner.digest.cccPositive') : t('owner.digest.cccTrapped');
    lines.push(t('owner.digest.ccc', { days: a.cashConversionCycle?.toFixed(0), suffix: cccSuffix }));
    lines.push(t('owner.digest.runRate', { rate: fmtINR(a.revenueRunRate ?? 0), growth: `${a.momRevGrowthPct >= 0 ? '+' : ''}${a.momRevGrowthPct?.toFixed(1)}` }));
    return lines;
  }, [kpis, a, t]);
}

// ── Ask-your-data (deterministic answers over the live KPIs) ──────────────────

function useAnswer() {
  const { t } = useTranslation();
  const { data: kpis } = useOverviewKPIs();
  const { data: a } = useAnalyticsKPIs();
  const { data: top } = useTopCustomers(5);
  return (q: string): string => {
    const s = q.toLowerCase();
    if (!kpis || !a) return t('owner.answer.loading');
    if (s.includes('margin')) return t('owner.answer.margin', { margin: a.grossMarginPct?.toFixed(1) });
    if (s.includes('dso') || s.includes('collect') || s.includes('outstanding')) return t('owner.answer.dso', { dso: a.dso?.toFixed(0), amount: fmtINR(kpis.debtorsOutstanding ?? 0) });
    if (s.includes('top') && s.includes('customer')) return top?.length ? t('owner.answer.topCustomer', { name: top[0].name, amount: fmtINR(top[0].mtdRevenue) }) : t('owner.answer.noCustomer');
    if (s.includes('revenue') || s.includes('run rate') || s.includes('run-rate')) return t('owner.answer.revenue', { rate: fmtINR(a.revenueRunRate ?? 0), growth: `${a.momRevGrowthPct >= 0 ? '+' : ''}${a.momRevGrowthPct?.toFixed(1)}` });
    if (s.includes('working capital') || s.includes('cash')) return t('owner.answer.workingCapital', { amount: fmtINR(a.netWorkingCapital ?? 0), days: a.cashConversionCycle?.toFixed(0) });
    return t('owner.answer.fallback');
  };
}

// ── What-if scenarios ─────────────────────────────────────────────────────────

const DRIVERS: { key: keyof CostConfig; label: string }[] = [
  { key: 'cl2RatePerMT', label: 'owner.driver.cl2' },
  { key: 'paraffinRatePerKg', label: 'owner.driver.paraffin' },
  { key: 'energyRatePerHour', label: 'owner.driver.energy' },
];

function WhatIf() {
  const { t } = useTranslation();
  const [driver, setDriver] = useState<keyof CostConfig>('cl2RatePerMT');
  const [pct, setPct] = useState(10);
  const [orderBookMT, setOrderBookMT] = useState(400);

  // A representative batch (1 MT output basis) costed at base vs shocked rates.
  const basis = { paraffinWeightKg: 1100, cl2QtyMT: 0.55, reactorHours: 5, outputMT: 10 };
  const base = computeBatchCost(basis, DEFAULT_COST_CONFIG);
  const shockedCfg: CostConfig = { ...DEFAULT_COST_CONFIG, [driver]: DEFAULT_COST_CONFIG[driver] * (1 + pct / 100) };
  const shocked = computeBatchCost(basis, shockedCfg);
  const deltaPerMT = shocked.costPerMT - base.costPerMT;
  const orderBookHit = deltaPerMT * orderBookMT;

  return (
    <div className="card2 p-6">
      <div className="text-base font-bold font-heading mb-1">{t('owner.whatif.title')}</div>
      <div className="text-xs text-slate-500 mb-4">{t('owner.whatif.subtitle')}</div>
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div>
          <div className="text-[11px] font-semibold text-slate-500 mb-1">{t('owner.whatif.driver')}</div>
          <select value={driver} onChange={e => setDriver(e.target.value as keyof CostConfig)} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none">
            {DRIVERS.map(d => <option key={d.key} value={d.key}>{t(d.label)}</option>)}
          </select>
        </div>
        <div>
          <div className="text-[11px] font-semibold text-slate-500 mb-1">{t('owner.whatif.change')}</div>
          <input type="number" value={pct} onChange={e => setPct(parseFloat(e.target.value) || 0)} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none" />
        </div>
        <div>
          <div className="text-[11px] font-semibold text-slate-500 mb-1">{t('owner.whatif.orderBook')}</div>
          <input type="number" value={orderBookMT} onChange={e => setOrderBookMT(parseFloat(e.target.value) || 0)} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
          <div className="text-xs text-slate-500">{t('owner.whatif.costImpact')}</div>
          <div className="text-xl font-bold num" style={{ color: deltaPerMT > 0 ? '#DC2626' : '#16A34A' }}>{deltaPerMT >= 0 ? '+' : ''}{fmtINR(deltaPerMT)}</div>
        </div>
        <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
          <div className="text-xs text-slate-500">{t('owner.whatif.orderBookHit')}</div>
          <div className="text-xl font-bold num" style={{ color: orderBookHit > 0 ? '#DC2626' : '#16A34A' }}>{orderBookHit >= 0 ? '+' : ''}{fmtINR(orderBookHit)}</div>
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function OwnerLayer() {
  const { t } = useTranslation();
  const toast = useToast();
  const digest = useDigest();
  const answer = useAnswer();
  const [q, setQ] = useState('');
  const [reply, setReply] = useState<string | null>(null);

  const quickChips: { labelKey: string; value: string }[] = [
    { labelKey: 'owner.chip.margin', value: 'Margin?' },
    { labelKey: 'owner.chip.dso', value: 'DSO?' },
    { labelKey: 'owner.chip.topCustomer', value: 'Top customer?' },
    { labelKey: 'owner.chip.runRate', value: 'Revenue run-rate?' },
  ];

  return (
    <>
      <div className="grid grid-cols-12 gap-5 mb-5">
        {/* Daily digest */}
        <div className="col-span-12 lg:col-span-6 card p-6" style={{ position: 'relative' }}>
          <KpiInfoButton info={{ title: 'Daily digest', what: 'An auto-generated end-of-day summary — sales, margin, collections, cash cycle — so the day no longer starts with three phone calls. Pushable to WhatsApp/email.', source: 'Derived', note: 'Composed live from the overview + analytics KPIs.' }} />
          <div className="flex items-center justify-between mb-3">
            <div className="text-base font-bold font-heading">{t('owner.dailyDigest.title')}</div>
            <button className="chip hover:bg-slate-200" onClick={() => toast.success(t('owner.digestQueued'))}>{t('owner.send')}</button>
          </div>
          <ul className="space-y-2">
            {digest.map((l, i) => (
              <li key={i} className="text-sm text-slate-600 flex gap-2"><span className="text-orange-400">•</span><span>{l}</span></li>
            ))}
          </ul>
        </div>

        {/* Ask-your-data */}
        <div className="col-span-12 lg:col-span-6 card p-6" style={{ position: 'relative' }}>
          <KpiInfoButton info={{ title: 'Ask your data', what: 'A natural-language layer over the data — ask a question, get a number. (Routes to the LLM analyst for open-ended queries.)', source: 'Derived', note: 'Deterministic answers over live KPIs today; LLM-backed for free-form questions.' }} />
          <div className="text-base font-bold font-heading mb-3">{t('owner.askData.title')}</div>
          <div className="flex gap-2">
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && q.trim()) setReply(answer(q)); }}
              placeholder={t('owner.askData.placeholder')}
              className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-200"
            />
            <button className="btn-accent rounded-[10px] px-4 font-semibold text-sm" onClick={() => q.trim() && setReply(answer(q))}>{t('owner.askData.ask')}</button>
          </div>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {quickChips.map(c => (
              <button key={c.value} className="chip text-xs" onClick={() => { setQ(c.value); setReply(answer(c.value)); }}>{t(c.labelKey)}</button>
            ))}
          </div>
          {reply && <div className="mt-4 p-3 rounded-xl bg-blue-50 border border-blue-100 text-sm text-blue-900">{reply}</div>}
        </div>
      </div>

      <WhatIf />
    </>
  );
}
