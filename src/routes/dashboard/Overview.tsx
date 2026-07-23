import React, { useState, useEffect } from 'react';
import { VoiceSearch } from '../../components/search/VoiceSearch';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ClipboardCheck, Wrench, Timer, BellRing, AlertTriangle, AlertCircle, Mic,
  CheckSquare, ShoppingCart, Truck, FlaskConical, Boxes, ArrowRight, Package,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { Database } from '../../lib/database.types';

type AlertRow = Database['public']['Tables']['alerts']['Row'];
type TankRow = Database['public']['Tables']['tanks']['Row'];
type DrumRow = Database['public']['Tables']['cpm_drum_stock']['Row'];
type ReqRow = Database['public']['Tables']['store_requisitions']['Row'] & { plants?: { name: string | null } | null };
import {
  useOverviewKPIs, useTopCustomers, useRecentMovements, useAnalyticsKPIs, fmtINR,
} from '../../hooks/useBusyData';
import { DSOGauge, RingProgress, MiniBarChart, BulletCompare, DeltaBadge, OverdueAgingBar } from '../../components/charts/AnalyticsViz';
import { KpiInfoButton } from '../../components/KpiInfoButton';
import { StockSnapshot } from '../../components/overview/StockSnapshot';
import { ButtonV2, SectionCard, StatusPill } from '../../components/v2';

/** Fallback source→route map for older alert rows without an explicit `route`. */
const ALERT_ROUTE: Record<string, string> = {
  'Marine ledger':     '/dashboard/purchase/marine',
  'CPM Stock':         '/dashboard/stock',
  'Batch · Oil Ratio': '/dashboard/batches',
  'Sales · Payments':  '/dashboard/sales',
  'Night Manager':     '/dashboard/night-manager',
  'Maintenance':       '/dashboard/purchase/maint',
};

/** Map movement type → dashboard route */
const MOVE_ROUTE: Record<string, string> = {
  batch:    '/dashboard/batches',
  sales:    '/dashboard/sales',
  purchase: '/dashboard/purchase/purchase',
  maint:    '/dashboard/purchase/maint',
  stock:    '/dashboard/stock',
};

/** Small numbered section label — "1. TODAY'S WORK" per the mockup. */
function SectionLabel({ n, children, right }: { n: number; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 mb-4">
      <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">
        {n}. {children}
      </div>
      {right}
    </div>
  );
}

/** One "Today's Work" mini-card: icon square, label, big number, caption. */
function WorkCard({ icon, label, value, caption, captionTone = 'slate', onClick }: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  caption?: React.ReactNode;
  captionTone?: 'slate' | 'orange' | 'green';
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left border border-slate-200 rounded-[10px] p-4 bg-white hover:border-slate-300 hover:shadow-sm transition flex-1 min-w-[150px]"
      style={{ fontFamily: 'inherit', cursor: onClick ? 'pointer' : 'default' }}
    >
      <span className="w-8 h-8 rounded-lg bg-slate-50 border border-slate-100 text-slate-500 inline-flex items-center justify-center [&>svg]:w-4 [&>svg]:h-4 mb-3">
        {icon}
      </span>
      <div className="text-[12.5px] text-slate-600 leading-snug">{label}</div>
      <div className="text-[26px] font-bold text-slate-900 leading-tight num">{value}</div>
      {caption && (
        <div className={`text-[11.5px] mt-0.5 ${captionTone === 'orange' ? 'text-orange-600 font-medium' : captionTone === 'green' ? 'text-green-600' : 'text-slate-400'}`}>
          {caption}
        </div>
      )}
    </button>
  );
}

/** One "Business KPIs" column: gray label, big value, colored delta line. */
function KpiBlock({ label, value, delta, deltaTone = 'slate', info }: {
  label: string;
  value: React.ReactNode;
  delta?: React.ReactNode;
  deltaTone?: 'green' | 'red' | 'orange' | 'slate';
  info?: React.ComponentProps<typeof KpiInfoButton>['info'];
}) {
  const toneCls = { green: 'text-green-600', red: 'text-red-600', orange: 'text-orange-600', slate: 'text-slate-400' }[deltaTone];
  return (
    <div className="flex-1 min-w-[150px] relative">
      {info && <KpiInfoButton info={info} style={{ top: -4, right: 0 }} />}
      <div className="text-[12px] text-slate-500">{label}</div>
      <div className="text-[24px] font-bold text-slate-900 num mt-1 leading-none">{value}</div>
      {delta && <div className={`text-[11.5px] mt-1.5 ${toneCls}`}>{delta}</div>}
    </div>
  );
}

const AGE = (ts: string | null) => {
  if (!ts) return '';
  const m = Math.floor((Date.now() - new Date(ts).getTime()) / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

const fmtDT = (d: string | null) => d
  ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
  : '—';

export function Overview() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [moveFilter, setMoveFilter] = useState('all');
  const [moveSearch, setMoveSearch] = useState('');
  const [alertsExpanded, setAlertsExpanded] = useState(false);

  // Live BUSY DB data
  const { data: kpis } = useOverviewKPIs();
  const { data: topCustomers } = useTopCustomers(3);
  const { data: busyMovements } = useRecentMovements(3);
  const { data: analytics } = useAnalyticsKPIs();

  // Supabase snapshot data
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [tanks, setTanks] = useState<TankRow[]>([]);
  const [drumRows, setDrumRows] = useState<DrumRow[]>([]);
  const [pendingReqs, setPendingReqs] = useState<ReqRow[]>([]);
  const [pendingStoreReq, setPendingStoreReq] = useState<number | null>(null);
  const [openMaint, setOpenMaint] = useState<number | null>(null);
  const [activeBatchCount, setActiveBatchCount] = useState<number | null>(null);
  const [avgBatchHours, setAvgBatchHours] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      const [alertsRes, tanksRes, drumsRes, reqRes, maintRes, batchesRes] = await Promise.all([
        supabase.from('alerts').select('*').eq('is_resolved', false).order('created_at', { ascending: false }).returns<AlertRow[]>(),
        supabase.from('tanks').select('*').order('sort_order', { ascending: true }).returns<TankRow[]>(),
        supabase.from('cpm_drum_stock').select('*').returns<DrumRow[]>(),
        supabase.from('store_requisitions').select('*, plants(name)').eq('status', 'pending').order('created_at', { ascending: false }).limit(8).returns<ReqRow[]>(),
        supabase.from('maintenance_tickets').select('*', { count: 'exact', head: true }).eq('type', 'emergency').neq('status', 'closed'),
        supabase.from('active_batches').select('started_at').eq('status', 'active').returns<{ started_at: string }[]>(),
      ]);
      setAlerts(alertsRes.data || []);
      setTanks(tanksRes.data || []);
      setDrumRows(drumsRes.data || []);
      setPendingReqs(reqRes.data || []);
      setPendingStoreReq(reqRes.error ? null : (reqRes.data?.length ?? 0));
      setOpenMaint(maintRes.error ? null : (maintRes.count ?? 0));

      const batches = batchesRes.data || [];
      setActiveBatchCount(batchesRes.error ? null : batches.length);
      if (batches.length > 0) {
        const avgMs = batches.reduce((sum, b) => sum + (Date.now() - new Date(b.started_at).getTime()), 0) / batches.length;
        setAvgBatchHours(Math.max(0, Math.round(avgMs / 3_600_000)));
      } else {
        setAvgBatchHours(null);
      }
    })();
  }, []);

  // Pivot drum rows into the density×location matrix (same shape as CPMStock).
  const densities = [...new Set(drumRows.map(r => r.density))].sort((a, b) => a - b);
  const locations = [...new Set(drumRows.map(r => r.location))];
  const drumLookup = new Map(drumRows.map(r => [`${r.location}|${r.density}`, r.drums]));
  const matrix: Record<string, number[]> = Object.fromEntries(
    locations.map(loc => [loc, densities.map(d => drumLookup.get(`${loc}|${d}`) ?? 0)]),
  );

  // Movements feed
  const movementsSource = busyMovements && busyMovements.length > 0 ? busyMovements : [];
  const filteredMoves = movementsSource
    .filter(m => moveFilter === 'all' || m.type === moveFilter)
    .filter(m => (m.title + m.sub).toLowerCase().includes(moveSearch.toLowerCase()));

  const displayCustomers = topCustomers && topCustomers.length > 0
    ? topCustomers.map(c => ({ name: c.name, mtdVal: fmtINR(c.mtdRevenue).replace('₹ ', '') }))
    : [{ name: '—', mtdVal: '—' }];

  const shownAlerts = alertsExpanded ? alerts : alerts.slice(0, 5);

  const QUICK_ACTIONS = [
    { icon: <CheckSquare />,  label: t('overview.qaApprove', 'Approve Requests'),   to: '/dashboard/purchase/storereq' },
    { icon: <ShoppingCart />, label: t('overview.qaPO', 'Purchase Orders'),         to: '/dashboard/purchase/purchase' },
    { icon: <Wrench />,       label: t('overview.qaMaint', 'Raise Maintenance'),    to: '/dashboard/purchase/maint' },
    { icon: <FlaskConical />, label: t('overview.qaBatch', 'Record Production'),    to: '/dashboard/batches' },
    { icon: <Truck />,        label: t('overview.qaSales', 'Sales & Dispatch'),     to: '/dashboard/sales' },
    { icon: <Boxes />,        label: t('overview.qaStock', 'View Stock'),           to: '/dashboard/stock' },
  ];

  return (
    <>
      {/* ── Row 1: Today's Work + Critical Alerts ── */}
      <div className="grid grid-cols-12 gap-4 mb-4">
        <SectionCard className="col-span-12 lg:col-span-8 !p-0" flush>
          <div className="p-5">
            <SectionLabel n={1}>{t('overview.todaysWork', "Today's Work")}</SectionLabel>
            <div className="flex gap-3 flex-wrap">
              <WorkCard
                icon={<ClipboardCheck />}
                label={t('overview.pendingApprovals', 'Pending Approvals')}
                value={pendingStoreReq ?? '…'}
                caption={pendingStoreReq ? t('overview.requiresAction', 'Requires your action →') : t('overview.allClear', 'All clear')}
                captionTone={pendingStoreReq ? 'orange' : 'green'}
                onClick={() => navigate('/dashboard/purchase/storereq')}
              />
              <WorkCard
                icon={<Wrench />}
                label={t('overview.openMaintenance', 'Open Maintenance')}
                value={openMaint ?? '…'}
                caption={openMaint ? t('overview.ticketsInProgress', 'Tickets in progress') : t('overview.noOpenTickets', 'No open tickets')}
                captionTone={openMaint ? 'orange' : 'green'}
                onClick={() => navigate('/dashboard/purchase/maint')}
              />
              <WorkCard
                icon={<Timer />}
                label={t('overview.activeBatches', 'Active Batches')}
                value={activeBatchCount ?? '…'}
                caption={avgBatchHours != null ? t('overview.avgElapsed', { hours: avgBatchHours, defaultValue: 'avg {{hours}}h elapsed' }) : t('overview.acrossFactories', { count: 4 })}
                onClick={() => navigate('/dashboard/batches')}
              />
              <WorkCard
                icon={<BellRing />}
                label={t('overview.openAlerts', 'Open Alerts')}
                value={alerts.length}
                caption={alerts.length ? t('overview.acrossModules', 'Across all modules') : t('overview.allQuiet', 'All quiet')}
                captionTone={alerts.length ? 'orange' : 'green'}
                onClick={() => document.getElementById('ov-alerts')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
              />
            </div>
          </div>
        </SectionCard>

        {/* Critical alerts */}
        <div id="ov-alerts" className="col-span-12 lg:col-span-4 card2 p-5">
          <SectionLabel
            n={2}
            right={alerts.length > 5 && (
              <button
                className="text-[12px] font-semibold text-blue-600 hover:underline"
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}
                onClick={() => setAlertsExpanded(e => !e)}
              >
                {alertsExpanded ? t('overview.showLess', 'Show less') : t('overview.viewAll', 'View all')}
              </button>
            )}
          >
            {t('overview.criticalAlerts', 'Critical Alerts')}
          </SectionLabel>
          <div className="space-y-1">
            {shownAlerts.map(a => {
              const route = a.route || ALERT_ROUTE[a.source || ''];
              const sev = a.severity === 'red' ? 'red' : a.severity === 'amber' ? 'amber' : 'slate';
              return (
                <div
                  key={a.id}
                  className={`flex items-start gap-2.5 py-2 rounded-lg px-1.5 -mx-1.5 ${route ? 'cursor-pointer hover:bg-slate-50' : ''}`}
                  onClick={() => route && navigate(route)}
                >
                  <span className={`w-6 h-6 rounded-md inline-flex items-center justify-center shrink-0 mt-0.5 ${sev === 'red' ? 'bg-red-50 text-red-500' : sev === 'amber' ? 'bg-amber-50 text-amber-500' : 'bg-slate-100 text-slate-400'}`}>
                    {sev === 'red' ? <AlertTriangle size={12} /> : <AlertCircle size={12} />}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium text-slate-800 leading-snug">{a.text}</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">{a.source}</div>
                  </div>
                  <span className="text-[11px] text-slate-400 shrink-0">{a.when_label || AGE(a.created_at)}</span>
                </div>
              );
            })}
            {alerts.length === 0 && <div className="text-[13px] text-slate-400 py-4 text-center">{t('overview.noOpenAlerts', 'No open alerts')}</div>}
          </div>
        </div>
      </div>

      {/* ── Row 2: Quick Actions ── */}
      <div className="card2 p-5 mb-4">
        <SectionLabel
          n={3}
          right={
            <button
              className="w-8 h-8 rounded-lg border border-slate-200 bg-white hover:border-orange-300 hover:bg-orange-50 inline-flex items-center justify-center text-slate-500 transition"
              onClick={() => setVoiceOpen(true)}
              aria-label={t('voice.heading')}
              title={t('voice.heading')}
            >
              <Mic size={14} />
            </button>
          }
        >
          {t('overview.quickActions', 'Quick Actions')}
        </SectionLabel>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
          {QUICK_ACTIONS.map(a => (
            <button
              key={a.label}
              onClick={() => navigate(a.to)}
              className="flex items-center justify-center gap-2 border border-slate-200 rounded-[10px] px-3 py-3 bg-white hover:border-slate-300 hover:bg-slate-50 transition text-[13px] font-medium text-slate-700"
              style={{ fontFamily: 'inherit', cursor: 'pointer' }}
            >
              <span className="text-slate-500 inline-flex [&>svg]:w-4 [&>svg]:h-4">{a.icon}</span>
              {a.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Row 3: Business KPIs (live BUSY data) ── */}
      <div className="card2 p-5 mb-4">
        <SectionLabel n={4}>{t('overview.businessKpis', 'Business KPIs')}</SectionLabel>
        <div className="flex gap-6 flex-wrap divide-x divide-slate-100 [&>*+*]:pl-6">
          <KpiBlock
            label={t('overview.totalSalesMtd', 'Total Sales (MTD)')}
            value={kpis ? fmtINR(kpis.salesMTD) : '…'}
            delta={analytics ? `${analytics.momRevGrowthPct >= 0 ? '+' : ''}${analytics.momRevGrowthPct}% ${t('overview.vsLastMonth', 'vs last month')}` : undefined}
            deltaTone={analytics && analytics.momRevGrowthPct >= 0 ? 'green' : 'red'}
            info={{ title: 'Sales MTD', what: 'Total sales invoiced to customers in the current calendar month. Counts only non-cancelled sales vouchers.', source: 'BUSY DB', tables: ['Tran1'], filter: 'VchType=9, Cancelled=0, current month' }}
          />
          <KpiBlock
            label={t('overview.fyRevenue', 'FY Revenue')}
            value={kpis ? fmtINR(kpis.fyRevenue) : '…'}
            delta={kpis ? t('overview.invoicesFy', { count: kpis.salesInvoiceCount }) : undefined}
          />
          <KpiBlock
            label={t('overview.purchasePaidMtd', 'Purchase Paid (MTD)')}
            value={kpis ? fmtINR(kpis.purchaseMTD) : '…'}
            delta={t('overview.inclMarineIns', 'incl. marine insurance')}
            info={{ title: 'Purchase MTD', what: 'Total purchase amount paid to suppliers in the current month, all plants consolidated.', source: 'BUSY DB', tables: ['Tran1'], filter: 'VchType=14, Cancelled=0, current month' }}
          />
          <KpiBlock
            label={t('overview.debtors', 'Debtors Outstanding')}
            value={kpis ? fmtINR(kpis.debtorsOutstanding) : '…'}
            delta={analytics ? `DSO ${analytics.dso}d` : undefined}
            deltaTone={analytics && analytics.dso > 30 ? 'orange' : 'green'}
          />
          <KpiBlock
            label={t('overview.pendingApprovals', 'Pending Approvals')}
            value={pendingStoreReq ?? '…'}
            delta={pendingStoreReq ? t('overview.requiresActionShort', 'Requires action') : t('overview.noChange', '— No change')}
            deltaTone={pendingStoreReq ? 'orange' : 'slate'}
          />
        </div>
      </div>

      {/* ── Row 4: Pending Approvals table (live store requisitions) ── */}
      <SectionCard className="mb-4" flush>
        <div className="px-5 pt-5 pb-1 flex items-center justify-between">
          <SectionLabel
            n={5}
            right={
              <button
                className="text-[12px] font-semibold text-blue-600 hover:underline"
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}
                onClick={() => navigate('/dashboard/purchase/storereq')}
              >
                {t('overview.viewAll', 'View all')}
              </button>
            }
          >
            {t('overview.pendingApprovals', 'Pending Approvals')}
          </SectionLabel>
        </div>
        <div className="overflow-x-auto scroll-x">
          <table className="dt2">
            <thead>
              <tr>
                <th>{t('overview.thType', 'Type')}</th>
                <th>{t('overview.thReference', 'Reference No.')}</th>
                <th>{t('overview.thItem', 'Item')}</th>
                <th>{t('overview.thFrom', 'From')}</th>
                <th className="num">{t('overview.thQty', 'Qty')}</th>
                <th>{t('overview.thRequestedOn', 'Requested On')}</th>
                <th>{t('overview.thAction', 'Action')}</th>
              </tr>
            </thead>
            <tbody>
              {pendingReqs.length === 0 && (
                <tr><td colSpan={7} className="text-center text-slate-400 py-6 text-sm">{t('overview.noPendingApprovals', 'Nothing awaiting approval')}</td></tr>
              )}
              {pendingReqs.map(r => (
                <tr key={r.id} onClick={() => navigate('/dashboard/purchase/storereq')} style={{ cursor: 'pointer' }}>
                  <td>
                    <span className="inline-flex items-center gap-1.5 text-slate-700 font-medium">
                      <Package size={13} className="text-slate-400" /> {t('overview.storeReq', 'Store Requisition')}
                    </span>
                  </td>
                  <td className="font-mono text-xs text-slate-400">#{r.id.slice(0, 8)}</td>
                  <td className="font-semibold text-slate-700">{r.item}</td>
                  <td>{r.plants?.name || '—'}</td>
                  <td className="num">{r.qty}</td>
                  <td className="text-slate-500">{fmtDT(r.created_at)}</td>
                  <td>
                    {['high', 'plant_stopper'].includes(r.urgency ?? '')
                      ? <StatusPill tone="red" label={t('overview.urgent', 'Urgent')} />
                      : (
                        <ButtonV2
                          size="sm" variant="outline"
                          className="text-green-700 border-green-200 hover:bg-green-50 hover:border-green-300"
                          onClick={(e) => { e.stopPropagation(); navigate('/dashboard/purchase/storereq'); }}
                        >
                          {t('overview.review', 'Review')}
                        </ButtonV2>
                      )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {pendingReqs.length > 0 && (
          <div className="px-5 py-3 text-[12px] text-slate-400 border-t border-slate-100">
            {t('overview.showingOf', { n: pendingReqs.length, defaultValue: 'Showing {{n}} of {{n}}' })}
          </div>
        )}
      </SectionCard>

      {/* ── Analytics Insight Row ── */}
      {analytics && (
        <div className="grid grid-cols-12 gap-4 mb-4">

          {/* DSO Gauge */}
          <div className="col-span-12 sm:col-span-6 lg:col-span-3 card2 p-5" style={{ position: 'relative' }}>
            <KpiInfoButton info={{ title: 'Days Sales Outstanding (DSO)', what: 'How many days on average it takes to collect payment after a sale is made. Lower is better — below 30d is best-in-class.', source: 'Derived', formula: 'DSO = (Debtors Outstanding / FY Revenue) × 365', tables: ['DailySum', 'Master1', 'Tran1'], note: 'Debtors = Master1 WHERE ParentGrp=116. Target < 30 days.' }} />
            <div className="text-[11px] text-slate-500 uppercase tracking-wider mb-1">{t('overview.daysSalesOutstanding')}</div>
            <div className="flex items-center gap-3">
              <DSOGauge value={analytics.dso} />
              <div>
                <div className="text-xs text-slate-500 leading-snug">{t('overview.targetUnder30')}<br/>{t('overview.turnover')} <strong className="text-slate-700">{analytics.debtorTurnover}×</strong></div>
                <div className="mt-2">
                  <DeltaBadge value={-(analytics.dso - 30)} unit={t('overview.dGap')} />
                </div>
              </div>
            </div>
          </div>

          {/* Gross Margin Ring */}
          <div className="col-span-12 sm:col-span-6 lg:col-span-3 card2 p-5" style={{ position: 'relative' }}>
            <KpiInfoButton info={{ title: 'Gross Margin %', what: 'Percentage of FY revenue remaining after subtracting total purchases.', source: 'Derived', formula: 'Gross Margin = (FY Revenue − FY Purchase) / FY Revenue × 100', tables: ['Tran1'], note: 'Industry benchmark for chemical mfg is ~28%.' }} />
            <div className="text-[11px] text-slate-500 uppercase tracking-wider mb-1">{t('overview.grossMarginFy')}</div>
            <div className="flex items-center gap-3">
              <RingProgress pct={analytics.grossMarginPct} color="#16A34A" label={t('overview.marginLabel')} />
              <div>
                <div className="text-[22px] font-extrabold text-green-700">{analytics.grossMarginPct}%</div>
                <div className="text-xs text-slate-500 mt-1">{t('overview.costRatio')} <strong className="text-slate-700">{analytics.purchaseToCostPct}%</strong></div>
                <div className="text-xs text-slate-500 mt-0.5">{t('overview.industryAvg28')}</div>
              </div>
            </div>
          </div>

          {/* Revenue Run Rate + bar sparkline */}
          <div className="col-span-12 lg:col-span-3 card2 p-5" style={{ position: 'relative' }}>
            <KpiInfoButton info={{ title: 'Annualised Revenue Run Rate', what: 'Projects full-year revenue based on the average of the last 2 complete months.', source: 'Derived', formula: 'Run Rate = avg(last 2 complete months revenue) × 12', tables: ['Tran1'] }} />
            <div className="text-[11px] text-slate-500 uppercase tracking-wider mb-1">{t('overview.annualisedRunRate')}</div>
            <div className="text-[22px] font-extrabold text-slate-800 num">{fmtINR(analytics.revenueRunRate)}</div>
            <div className="flex items-center gap-2 mt-1 mb-2">
              <DeltaBadge value={analytics.momRevGrowthPct} />
              <span className="text-[10px] text-slate-500">{t('overview.momRevGrowth')}</span>
            </div>
            <MiniBarChart
              data={analytics.monthly.map(m => m.revenue)}
              labels={analytics.monthly.map(m => m.label)}
              color="#F47651"
              height={36}
            />
          </div>

          {/* Working Capital — debtors vs creditors */}
          <div className="col-span-12 lg:col-span-3 card2 p-5" style={{ position: 'relative' }}>
            <KpiInfoButton info={{ title: 'Net Working Capital', what: 'Total debtors outstanding minus total creditors outstanding.', source: 'Derived', formula: 'NWC = Debtors Outstanding − Creditors Outstanding', tables: ['DailySum', 'Master1'] }} />
            <div className="text-[11px] text-slate-500 uppercase tracking-wider mb-1">{t('overview.netWorkingCapital')}</div>
            <div className={`text-[22px] font-extrabold num ${analytics.netWorkingCapital >= 0 ? 'text-green-700' : 'text-red-600'}`}>
              {analytics.netWorkingCapital >= 0 ? '+' : ''}{fmtINR(analytics.netWorkingCapital)}
            </div>
            <div className="text-[10px] text-slate-500 mb-3 mt-0.5">{t('overview.debtorsMinusCreditors')}</div>
            <BulletCompare
              left={kpis?.debtorsOutstanding ?? 0}
              right={analytics.creditorsOutstanding}
              leftLabel={`${t('overview.debtors')} ${fmtINR(kpis?.debtorsOutstanding ?? 0)}`}
              rightLabel={`${t('overview.creditors')} ${fmtINR(analytics.creditorsOutstanding)}`}
              leftColor="#F47651"
              rightColor="#2563EB"
            />
          </div>
        </div>
      )}

      {/* ── Analytics Insight Row 2 — Liquidity & Risk ── */}
      {analytics && analytics.dpo !== undefined && (
        <div className="grid grid-cols-12 gap-4 mb-4">

          {/* DPO + Cash Conversion Cycle */}
          <div className="col-span-12 sm:col-span-6 lg:col-span-3 card2 p-5" style={{ position: 'relative' }}>
            <KpiInfoButton info={{ title: 'DPO & Cash Conversion Cycle', what: 'DPO = how many days before the company pays its suppliers. CCC = DSO minus DPO.', source: 'Derived', formula: 'DPO = (Creditors Outstanding / FY Purchase) × 365\nCCC = DSO − DPO' }} />
            <div className="text-[11px] text-slate-500 uppercase tracking-wider mb-1">{t('overview.payablesCycleDpo')}</div>
            <div className="text-[28px] font-extrabold num text-blue-700">{analytics.dpo} d</div>
            <div className="text-[11px] text-slate-500 mt-0.5">{t('overview.daysPayableOutstanding')}</div>
            <div className="mt-3 pt-3 border-t border-slate-100">
              <div className="text-[10px] text-slate-400 uppercase tracking-wider">{t('overview.cashConversionCycle')}</div>
              <div className={`text-[18px] font-extrabold num mt-0.5 ${analytics.cashConversionCycle <= 0 ? 'text-green-700' : 'text-amber-600'}`}>
                {analytics.cashConversionCycle > 0 ? '+' : ''}{analytics.cashConversionCycle} d
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">
                {analytics.cashConversionCycle <= 0 ? t('overview.cashPositiveCycle') : t('overview.dsoMinusDpoTied')}
              </div>
            </div>
          </div>

          {/* Collection Ratio */}
          <div className="col-span-12 sm:col-span-6 lg:col-span-3 card2 p-5" style={{ position: 'relative' }}>
            <KpiInfoButton info={{ title: 'Collection Ratio MTD', what: "Percentage of this month's sales revenue that has already been received as cash.", source: 'Derived', formula: 'Collection Ratio = MTD Receipts / MTD Sales × 100' }} />
            <div className="text-[11px] text-slate-500 uppercase tracking-wider mb-2">{t('overview.collectionRatioMtd')}</div>
            <div className="flex items-center gap-3">
              <RingProgress pct={Math.min(analytics.collectionRatioMTD, 100)} color="#2563EB" label={t('overview.collectedLabel')} />
              <div>
                <div className="text-[22px] font-extrabold text-blue-700">{analytics.collectionRatioMTD.toFixed(0)}%</div>
                <div className="text-[10px] text-slate-400 mt-1 leading-snug">
                  {t('overview.receiptsVsInvoicedMtd')}
                </div>
              </div>
            </div>
          </div>

          {/* Overdue Aging */}
          <div className="col-span-12 lg:col-span-3 card2 p-5" style={{ position: 'relative' }}>
            <KpiInfoButton info={{ title: 'Overdue Aging Buckets', what: 'Outstanding bills broken into 4 age bands. Older buckets have higher collection risk.', source: 'BUSY DB', tables: ['Tran3'], filter: 'RecType=5, Status=1 (pending), DueDate < today' }} />
            <div className="flex items-center justify-between mb-3">
              <div className="text-[11px] text-slate-500 uppercase tracking-wider">{t('overview.overdueAging')}</div>
              <div className="text-[11px] font-bold text-red-600">
                {fmtINR(analytics.overdueAging.d1_30 + analytics.overdueAging.d31_60 + analytics.overdueAging.d61_90 + analytics.overdueAging.d90plus)} {t('overview.total')}
              </div>
            </div>
            <OverdueAgingBar aging={analytics.overdueAging} />
          </div>

          {/* Revenue vs Cash Gap */}
          <div className="col-span-12 lg:col-span-3 card2 p-5" style={{ position: 'relative' }}>
            <KpiInfoButton info={{ title: 'Revenue vs Cash Received Gap', what: 'FY revenue invoiced minus FY receipts actually received — the total still owed across all customers.', source: 'Derived', formula: 'Gap = FY Revenue − FY Receipts (VchType=16)' }} />
            <div className="text-[11px] text-slate-500 uppercase tracking-wider mb-1">{t('overview.revenueVsCashFy')}</div>
            <div className="text-[22px] font-extrabold num text-amber-600">{fmtINR(analytics.revenueReceiptsGap)}</div>
            <div className="text-[10px] text-slate-400 mt-0.5 mb-3">{t('overview.uncollectedGap')}</div>
            <BulletCompare
              left={analytics.fyReceipts}
              right={analytics.revenueReceiptsGap}
              leftLabel={`${t('overview.received')} ${fmtINR(analytics.fyReceipts)}`}
              rightLabel={`${t('overview.gap')} ${fmtINR(analytics.revenueReceiptsGap)}`}
              leftColor="#16A34A"
              rightColor="#F59E0B"
            />
          </div>
        </div>
      )}

      {/* ── Movements + Top customers ── */}
      <div className="grid grid-cols-12 gap-4 mb-4">

        {/* Movements feed */}
        <div className="col-span-12 lg:col-span-8 card2 p-5" style={{ position: 'relative' }}>
          <KpiInfoButton info={{ title: "Today's Movements Feed", what: 'Real-time activity feed showing sales, purchase, batch, stock, and maintenance events from the last 3 days. Click any row to navigate to the source module.', source: 'BUSY DB', tables: ['Tran1', 'Master1'], filter: 'VchType in (9,14,16,19), last 3 days' }} />
          <div className="text-base font-bold font-heading mb-3">{t('overview.todaysMovements')}</div>

          {/* Search */}
          <div className="relative mb-3">
            <input
              value={moveSearch}
              onChange={e => setMoveSearch(e.target.value)}
              placeholder={t('overview.searchMovesPlaceholder')}
              className="pl-10 pr-4 py-2.5 w-full bg-white border border-slate-200 rounded-[10px] text-sm focus:outline-none focus:ring-2 focus:ring-slate-200 transition"
            />
            <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>
            </svg>
          </div>

          {/* Filter chips */}
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            {['all','purchase','sales','batch','stock','maint'].map(f => (
              <div
                key={f}
                className={`chip${moveFilter === f ? ' active' : ''}`}
                onClick={() => setMoveFilter(f)}
              >
                <span>{t(`overview.movefilter_${f}`)}</span>
              </div>
            ))}
          </div>

          {/* List */}
          <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
            {filteredMoves.length > 0 ? filteredMoves.map((m, i) => (
              <div
                key={i}
                className="flex items-center gap-3 p-3 rounded-[10px] border border-slate-100 hover:border-slate-200 hover:bg-slate-50 cursor-pointer transition"
                onClick={() => navigate(MOVE_ROUTE[m.type] ?? '/dashboard')}
              >
                <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 bg-slate-50 border border-slate-100 text-slate-500">
                  <ArrowRight size={13} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm leading-tight truncate">{m.title}</div>
                  <div className="text-xs text-slate-500 truncate">{m.sub}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-semibold" style={{ color: m.col }}>{m.amt}</div>
                  <div className="text-[10px] text-slate-400">{m.when}</div>
                </div>
              </div>
            )) : (
              <div className="text-center py-10 text-slate-400 text-sm">{t('overview.noMovementsMatch')}</div>
            )}
          </div>
        </div>

        {/* Top customers snapshot */}
        <div className="col-span-12 lg:col-span-4 card2 p-5" style={{ position: 'relative' }}>
          <KpiInfoButton info={{ title: 'Customer History Snapshot', what: 'Top 3 customers ranked by MTD sales revenue, pulled live from BUSY.', source: 'BUSY DB', tables: ['Tran1', 'Master1'], filter: 'VchType=9, Cancelled=0, TOP 3 by MTD revenue' }} />
          <div className="text-base font-bold font-heading">{t('overview.customerHistorySnapshot')}</div>
          <div className="text-xs text-slate-500 mt-0.5 mb-3">{t('overview.top3ByMtdRevenue')}</div>
          <div className="space-y-1">
            {displayCustomers.map(c => (
              <div
                key={c.name}
                className="flex items-center justify-between py-2.5 border-b border-slate-100 last:border-0 cursor-pointer hover:bg-slate-50 rounded-lg px-1.5 -mx-1.5 transition-colors"
                onClick={() => navigate('/dashboard/customers')}
              >
                <div className="text-sm font-medium truncate pr-2">{c.name}</div>
                <div className="text-sm font-bold font-heading num shrink-0">₹ {c.mtdVal}</div>
              </div>
            ))}
          </div>
          <button
            className="text-blue-600 text-xs font-semibold mt-3 hover:underline"
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}
            onClick={() => navigate('/dashboard/customers')}
          >
            {t('overview.openCustomerHistory')} →
          </button>
        </div>
      </div>

      <StockSnapshot
        densities={densities}
        locations={locations}
        matrix={matrix}
        tanks={tanks}
        onOpenStock={() => navigate('/dashboard/stock')}
      />

      <VoiceSearch open={voiceOpen} onClose={() => setVoiceOpen(false)} />
    </>
  );
}
