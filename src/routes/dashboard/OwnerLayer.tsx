import React, { useMemo, useState } from 'react';
import { useOverviewKPIs, useAnalyticsKPIs, useTopCustomers, fmtINR } from '../../hooks/useBusyData';
import { useToast } from '../../components/ui/toast';
import { KpiInfoButton } from '../../components/KpiInfoButton';
import { computeBatchCost, DEFAULT_COST_CONFIG, type CostConfig } from '../../lib/algorithms/costEngine';

// ── Daily digest ──────────────────────────────────────────────────────────────

function useDigest(): string[] {
  const { data: kpis } = useOverviewKPIs();
  const { data: a } = useAnalyticsKPIs();
  return useMemo(() => {
    if (!kpis || !a) return ['Gathering today’s numbers…'];
    const lines: string[] = [];
    lines.push(`Sales MTD: ${fmtINR(kpis.salesMTD ?? 0)} · gross margin ${a.grossMarginPct?.toFixed(1)}%.`);
    lines.push(`Debtors outstanding ${fmtINR(kpis.debtorsOutstanding ?? 0)} · DSO ${a.dso?.toFixed(0)} days.`);
    const overdue = (a.overdueAging?.d31_60 ?? 0) + (a.overdueAging?.d61_90 ?? 0) + (a.overdueAging?.d90plus ?? 0);
    if (overdue > 0) lines.push(`Overdue beyond 30 days: ${fmtINR(overdue)} — chase these.`);
    lines.push(`Cash-conversion cycle ${a.cashConversionCycle?.toFixed(0)} days ${a.cashConversionCycle <= 0 ? '(cash-positive).' : '— trapped cash.'}`);
    lines.push(`Revenue run-rate ${fmtINR(a.revenueRunRate ?? 0)}/yr (${a.momRevGrowthPct >= 0 ? '+' : ''}${a.momRevGrowthPct?.toFixed(1)}% MoM).`);
    return lines;
  }, [kpis, a]);
}

// ── Ask-your-data (deterministic answers over the live KPIs) ──────────────────

function useAnswer() {
  const { data: kpis } = useOverviewKPIs();
  const { data: a } = useAnalyticsKPIs();
  const { data: top } = useTopCustomers(5);
  return (q: string): string => {
    const s = q.toLowerCase();
    if (!kpis || !a) return 'Still loading the numbers — try again in a moment.';
    if (s.includes('margin')) return `Gross margin is ${a.grossMarginPct?.toFixed(1)}% (FY revenue minus FY purchase, over revenue).`;
    if (s.includes('dso') || s.includes('collect') || s.includes('outstanding')) return `DSO is ${a.dso?.toFixed(0)} days; debtors outstanding ${fmtINR(kpis.debtorsOutstanding ?? 0)}.`;
    if (s.includes('top') && s.includes('customer')) return top?.length ? `Top customer is ${top[0].name} at ${fmtINR(top[0].mtdRevenue)} MTD.` : 'No customer data yet.';
    if (s.includes('revenue') || s.includes('run rate') || s.includes('run-rate')) return `Annualised revenue run-rate is ${fmtINR(a.revenueRunRate ?? 0)} (${a.momRevGrowthPct >= 0 ? '+' : ''}${a.momRevGrowthPct?.toFixed(1)}% MoM).`;
    if (s.includes('working capital') || s.includes('cash')) return `Net working capital ${fmtINR(a.netWorkingCapital ?? 0)}; cash-conversion cycle ${a.cashConversionCycle?.toFixed(0)} days.`;
    return 'I can answer on margin, DSO/collections, top customers, revenue run-rate, and working capital today. (A full natural-language layer routes here to the LLM analyst.)';
  };
}

// ── What-if scenarios ─────────────────────────────────────────────────────────

const DRIVERS: { key: keyof CostConfig; label: string }[] = [
  { key: 'cl2RatePerMT', label: 'Cl₂ price' },
  { key: 'paraffinRatePerKg', label: 'Paraffin price' },
  { key: 'energyRatePerHour', label: 'Energy rate' },
];

function WhatIf() {
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
    <div className="card p-6">
      <div className="text-base font-bold mb-1">What-if scenario</div>
      <div className="text-xs text-slate-500 mb-4">Shock a cost driver and see the hit to the order book — against the live cost engine.</div>
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div>
          <div className="text-[11px] font-semibold text-slate-500 mb-1">Driver</div>
          <select value={driver} onChange={e => setDriver(e.target.value as keyof CostConfig)} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none">
            {DRIVERS.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
          </select>
        </div>
        <div>
          <div className="text-[11px] font-semibold text-slate-500 mb-1">Change (%)</div>
          <input type="number" value={pct} onChange={e => setPct(parseFloat(e.target.value) || 0)} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none" />
        </div>
        <div>
          <div className="text-[11px] font-semibold text-slate-500 mb-1">Order book (MT)</div>
          <input type="number" value={orderBookMT} onChange={e => setOrderBookMT(parseFloat(e.target.value) || 0)} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
          <div className="text-xs text-slate-500">Cost / MT impact</div>
          <div className="text-xl font-bold num" style={{ color: deltaPerMT > 0 ? '#DC2626' : '#16A34A' }}>{deltaPerMT >= 0 ? '+' : ''}{fmtINR(deltaPerMT)}</div>
        </div>
        <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
          <div className="text-xs text-slate-500">Hit to order book</div>
          <div className="text-xl font-bold num" style={{ color: orderBookHit > 0 ? '#DC2626' : '#16A34A' }}>{orderBookHit >= 0 ? '+' : ''}{fmtINR(orderBookHit)}</div>
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function OwnerLayer() {
  const toast = useToast();
  const digest = useDigest();
  const answer = useAnswer();
  const [q, setQ] = useState('');
  const [reply, setReply] = useState<string | null>(null);

  return (
    <>
      <div className="grid grid-cols-12 gap-5 mb-5">
        {/* Daily digest */}
        <div className="col-span-12 lg:col-span-6 card p-6" style={{ position: 'relative' }}>
          <KpiInfoButton info={{ title: 'Daily digest', what: 'An auto-generated end-of-day summary — sales, margin, collections, cash cycle — so the day no longer starts with three phone calls. Pushable to WhatsApp/email.', source: 'Derived', note: 'Composed live from the overview + analytics KPIs.' }} />
          <div className="flex items-center justify-between mb-3">
            <div className="text-base font-bold">Daily digest</div>
            <button className="chip hover:bg-slate-200" onClick={() => toast.success('Digest queued — wires to WhatsApp/email when configured')}>Send</button>
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
          <div className="text-base font-bold mb-3">Ask your data</div>
          <div className="flex gap-2">
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && q.trim()) setReply(answer(q)); }}
              placeholder="e.g. what's our margin? · DSO? · top customer?"
              className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-200"
            />
            <button className="btn-accent pill px-4 font-semibold text-sm" onClick={() => q.trim() && setReply(answer(q))}>Ask</button>
          </div>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {['Margin?', 'DSO?', 'Top customer?', 'Revenue run-rate?'].map(s => (
              <button key={s} className="chip text-xs" onClick={() => { setQ(s); setReply(answer(s)); }}>{s}</button>
            ))}
          </div>
          {reply && <div className="mt-4 p-3 rounded-xl bg-blue-50 border border-blue-100 text-sm text-blue-900">{reply}</div>}
        </div>
      </div>

      <WhatIf />
    </>
  );
}
