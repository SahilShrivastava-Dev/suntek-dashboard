import React, { useState, useRef, useEffect } from 'react';
import { VoiceSearch } from '../../components/search/VoiceSearch';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import type { Database } from '../../lib/database.types';

type AlertRow = Database['public']['Tables']['alerts']['Row'];
type TankRow = Database['public']['Tables']['tanks']['Row'];
type DrumRow = Database['public']['Tables']['cpm_drum_stock']['Row'];
import {
  useOverviewKPIs, useTopCustomers, useRecentMovements, useAnalyticsKPIs, fmtINR,
} from '../../hooks/useBusyData';
import { DSOGauge, RingProgress, MiniBarChart, BulletCompare, DeltaBadge, OverdueAgingBar } from '../../components/charts/AnalyticsViz';
import { KpiInfoButton } from '../../components/KpiInfoButton';
import { StockSnapshot } from '../../components/overview/StockSnapshot';
import { AlertsPanel } from '../../components/overview/AlertsPanel';

const now = new Date();

// ── Helpers ──────────────────────────────────────────────────────────────────
function toast(msg: string) {
  const existing = document.getElementById('sk-toast');
  if (!existing) return;
  existing.textContent = msg;
  existing.classList.add('show');
  setTimeout(() => existing.classList.remove('show'), 2200);
}

const COMPANIES = ['All', 'SCPL', 'SPPL', 'KG', 'Madan'];
const PERIODS   = ['FY 26-27 · Q1', 'FY 26-27 · Q2', 'FY 26-27 · Q3', 'FY 26-27 · Q4', 'FY 26-27 · Full Year'];

// Module nav cards. `countKey` (optional) wires a live pending count from the DB;
// modules without one simply render no badge.
type ModuleDef = {
  name: string;
  page: string;
  sub: string;
  accent?: boolean;
  countKey?: 'purchase' | 'batch';
};
const MODULES: ModuleDef[] = [
  { name: 'Purchase',         page: 'purchase',  sub: 'FAR · Maint · Activity · Store Req · POs · Marine · Labour', accent: true, countKey: 'purchase' },
  { name: 'Sales',            page: 'sales',     sub: 'Contracts · dispatch · HCL/Acid' },
  { name: 'CPM Stock',        page: 'stock',     sub: 'Tanks · drums · 400+ store SKUs' },
  { name: 'Batch Sheet',      page: 'batch',     sub: 'Reactor runs · QC · oil-ratio', countKey: 'batch' },
  { name: 'Customer History', page: 'customers', sub: 'Ledger · density · payments' },
  { name: 'Night Manager',    page: 'nightmgr',  sub: 'On-duty · GPS · photos' },
];

// Purely-visual batch status dot grid (35 dots): 3 = orange, 2 = light-orange, 1 = grey.
const BATCH_GRID_PATTERN = [3,3,3,2,2,2,1,1,1,3,3,2,2,1,3,3,2,3,3,3,1,2,3,2,3,3,2,2,3,2,1,3,1,3,3];

/** Map movement type → dashboard route */
const MOVE_ROUTE: Record<string, string> = {
  batch:    '/dashboard/batches',
  sales:    '/dashboard/sales',
  purchase: '/dashboard/purchase/purchase',
  maint:    '/dashboard/purchase/maint',
  stock:    '/dashboard/stock',
};

export function Overview() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [moveFilter, setMoveFilter] = useState('all');
  const [moveSearch, setMoveSearch] = useState('');

  // Live BUSY DB data
  const { data: kpis } = useOverviewKPIs();
  const { data: topCustomers } = useTopCustomers(3);
  const { data: busyMovements } = useRecentMovements(3);
  const { data: analytics } = useAnalyticsKPIs();

  // Supabase snapshot data (alerts feed + stock snapshot)
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [tanks, setTanks] = useState<TankRow[]>([]);
  const [drumRows, setDrumRows] = useState<DrumRow[]>([]);

  // Live pending counts (replace former hardcoded badge numbers)
  const [pendingStoreReq, setPendingStoreReq] = useState<number | null>(null);
  const [activeBatchCount, setActiveBatchCount] = useState<number | null>(null);
  const [avgBatchHours, setAvgBatchHours] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      const [alertsRes, tanksRes, drumsRes, storeReqRes, batchesRes] = await Promise.all([
        supabase.from('alerts').select('*').eq('is_resolved', false).order('created_at', { ascending: false }).returns<AlertRow[]>(),
        supabase.from('tanks').select('*').order('sort_order', { ascending: true }).returns<TankRow[]>(),
        supabase.from('cpm_drum_stock').select('*').returns<DrumRow[]>(),
        supabase.from('store_requisitions').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('active_batches').select('started_at').eq('status', 'active').returns<{ started_at: string }[]>(),
      ]);
      setAlerts(alertsRes.data || []);
      setTanks(tanksRes.data || []);
      setDrumRows(drumsRes.data || []);

      setPendingStoreReq(storeReqRes.error ? null : (storeReqRes.count ?? 0));

      const batches = batchesRes.data || [];
      setActiveBatchCount(batchesRes.error ? null : batches.length);
      if (batches.length > 0) {
        const avgMs = batches.reduce(
          (sum, b) => sum + (Date.now() - new Date(b.started_at).getTime()), 0,
        ) / batches.length;
        setAvgBatchHours(Math.max(0, Math.round(avgMs / 3_600_000)));
      } else {
        setAvgBatchHours(null);
      }
    })();
  }, []);

  // Map module countKey → live count (omit badge when count is falsy/unknown).
  const moduleCounts: Record<NonNullable<ModuleDef['countKey']>, number | null> = {
    purchase: pendingStoreReq,
    batch: activeBatchCount,
  };

  // Pivot drum rows into the density×location matrix (same shape as CPMStock).
  const densities = [...new Set(drumRows.map(r => r.density))].sort((a, b) => a - b);
  const locations = [...new Set(drumRows.map(r => r.location))];
  const drumLookup = new Map(drumRows.map(r => [`${r.location}|${r.density}`, r.drums]));
  const matrix: Record<string, number[]> = Object.fromEntries(
    locations.map(loc => [loc, densities.map(d => drumLookup.get(`${loc}|${d}`) ?? 0)]),
  );

  // Company + period filter dropdowns
  const [company, setCompany]         = useState('All');
  const [period, setPeriod]           = useState('FY 26-27 · Q1');
  const [showCompanyDD, setShowCompanyDD] = useState(false);
  const [showPeriodDD,  setShowPeriodDD]  = useState(false);
  const companyRef = useRef<HTMLDivElement>(null);
  const periodRef  = useRef<HTMLDivElement>(null);

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (companyRef.current && !companyRef.current.contains(e.target as Node)) {
        setShowCompanyDD(false);
      }
      if (periodRef.current && !periodRef.current.contains(e.target as Node)) {
        setShowPeriodDD(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Use live BUSY movements (last 3 days) with fallback to empty
  const movementsSource = busyMovements && busyMovements.length > 0 ? busyMovements : [];
  const filteredMoves = movementsSource
    .filter(m => moveFilter === 'all' || m.type === moveFilter)
    .filter(m => (m.title + m.sub).toLowerCase().includes(moveSearch.toLowerCase()));

  const displayCustomers = topCustomers && topCustomers.length > 0
    ? topCustomers.map(c => ({ name: c.name, mtdVal: fmtINR(c.mtdRevenue).replace('₹ ', '') }))
    : [{ name: '—', mtdVal: '—' }];

  return (
    <>
      {/* ── Hero card ── */}
      <div className="card p-5 md:p-6 mb-5">
        <div className="flex items-center justify-between gap-6 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap">
            {/* Date widget */}
            <div className="flex items-center gap-3 pl-2 pr-1 py-1 bg-slate-50 border border-slate-200 rounded-full">
              <div className="w-12 h-12 rounded-full bg-white border border-slate-200 flex items-center justify-center">
                <span className="text-xl font-extrabold leading-none">{now.getDate()}</span>
              </div>
              <div className="pr-3 leading-tight">
                <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                  {now.toLocaleDateString('en-IN', { weekday: 'short' })}
                </div>
                <div className="text-[13px] font-semibold">
                  {now.toLocaleDateString('en-IN', { month: 'long' })}
                </div>
              </div>
            </div>

            {/* Pending approvals */}
            <button
              className="btn-accent pill px-5 py-3 font-semibold text-sm flex items-center gap-2 shadow-sm"
              onClick={() => navigate('/dashboard/purchase/storereq')}
            >
              <span>{t('overview.pendingApprovals')}</span>
              <span className="bg-white/20 text-white text-[11px] font-bold px-2 py-0.5 rounded-full">{pendingStoreReq ?? '…'}</span>
            </button>

            {/* Company filter chip — functional dropdown */}
            <div className="relative" ref={companyRef}>
              <button
                className="chip"
                onClick={() => { setShowCompanyDD(v => !v); setShowPeriodDD(false); }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                </svg>
                <span>{company === 'All' ? t('overview.allCompanies') : company}</span>
                <svg
                  width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"
                  style={{ transform: showCompanyDD ? 'rotate(180deg)' : undefined, transition: 'transform 0.15s' }}
                >
                  <path d="m6 9 6 6 6-6"/>
                </svg>
              </button>
              {showCompanyDD && (
                <div className="absolute top-full left-0 mt-1.5 z-50 bg-white border border-slate-200 rounded-2xl shadow-lg overflow-hidden min-w-[148px]">
                  {COMPANIES.map(c => (
                    <button
                      key={c}
                      className={`w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50 transition-colors ${company === c ? 'font-bold text-orange-600' : 'text-slate-700'}`}
                      onClick={() => { setCompany(c); setShowCompanyDD(false); }}
                    >
                      {c === 'All' ? t('overview.allCompanies') : c}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Voice / greeting */}
          <div className="flex items-center gap-3 flex-1 justify-end min-w-[260px]">
            <div className="text-right">
              <div className="serif text-[24px] md:text-[30px] leading-[1]">{t('overview.heroGreeting')}</div>
              <div className="text-slate-400 text-[13px]">{t('overview.heroSubtitle')}</div>
            </div>
            <button
              className="w-12 h-12 rounded-full bg-white border border-slate-200 hover:border-orange-300 hover:bg-orange-50 flex items-center justify-center transition"
              onClick={() => setVoiceOpen(true)}
              aria-label={t('voice.heading')}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="2" width="6" height="12" rx="3"/>
                <path d="M5 10a7 7 0 0 0 14 0"/>
                <path d="M12 17v4M8 21h8"/>
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* ── KPI Grid (12-col) ── */}
      <div className="grid grid-cols-12 gap-5 mb-5">

        {/* All Companies card — blue (live BUSY data) */}
        <div className="col-span-12 lg:col-span-4 card p-6" style={{ background: 'var(--blue-soft)', border: '1px solid #bfdbfe', position: 'relative' }}>
          <KpiInfoButton info={{ title: 'All Companies Summary', what: 'Top-level FY revenue, total debtors outstanding, and FY customer receipts consolidated across all 4 Suntek group companies: SCPL, SPPL, KG, Madan. Data is live from BUSY accounting.', source: 'BUSY DB', tables: ['Tran1', 'DailySum', 'Master1'], dbPath: 'BusyFY2026 > dbo > Tables > Tran1\nBusyFY2026 > dbo > Tables > DailySum', filter: 'VchType=9 (Revenue) · VchType=16 (Receipts) · ParentGrp=116 (Debtors)' }} style={{ top: 48, right: 10 }} />
          <div className="flex items-start justify-between mb-3">
            <div className="text-[10px] font-bold tracking-[0.18em] text-slate-400 uppercase">
              SCPL · SPPL · KG · MADAN
            </div>
            {/* Period filter chip — functional dropdown */}
            <div className="relative" ref={periodRef}>
              <button
                className="chip text-xs"
                onClick={() => { setShowPeriodDD(v => !v); setShowCompanyDD(false); }}
              >
                <span>{period}</span>
                <svg
                  width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"
                  style={{ transform: showPeriodDD ? 'rotate(180deg)' : undefined, transition: 'transform 0.15s' }}
                >
                  <path d="m6 9 6 6 6-6"/>
                </svg>
              </button>
              {showPeriodDD && (
                <div className="absolute top-full right-0 mt-1.5 z-50 bg-white border border-slate-200 rounded-2xl shadow-lg overflow-hidden min-w-[190px]">
                  {PERIODS.map(p => (
                    <button
                      key={p}
                      className={`w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50 transition-colors ${period === p ? 'font-bold text-orange-600' : 'text-slate-700'}`}
                      onClick={() => { setPeriod(p); setShowPeriodDD(false); }}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="text-slate-500 text-sm">
            {t('overview.fyRevenue')}: <strong>{kpis ? fmtINR(kpis.fyRevenue) : '…'}</strong>
            &nbsp;·&nbsp;
            {t('overview.debtors')}: <strong>{kpis ? fmtINR(kpis.debtorsOutstanding) : '…'}</strong>
          </div>
          <div className="serif text-[40px] leading-[1] mt-2 mb-5">{t('overview.allCompanies')}</div>
          <div className="grid grid-cols-2 gap-3 mb-5">
            <button
              className="btn-dark pill py-3 font-semibold text-sm flex items-center justify-center gap-2"
              onClick={() => navigate('/dashboard/purchase/storereq')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M20 6 9 17l-5-5"/>
              </svg>
              {t('overview.approve')} <span className="bg-white/15 px-1.5 rounded">{pendingStoreReq ?? '…'}</span>
            </button>
            <button
              className="btn-ghost pill py-3 font-semibold text-sm flex items-center justify-center gap-2"
              onClick={() => navigate('/dashboard/purchase/storereq')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="m18.5 2.5 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
              {t('overview.review')}
            </button>
          </div>
          <div className="flex items-end justify-between border-t border-slate-100 pt-4">
            <div>
              <div className="text-xs text-slate-500">{t('overview.fyReceiptsFromCustomers')}</div>
              <div className="text-xl font-bold mt-0.5 num">{kpis ? fmtINR(kpis.receiptsMTD) : '…'}</div>
            </div>
            <button
              className="text-orange-600 font-medium text-xs flex items-center gap-1.5 hover:gap-2 transition-all"
              onClick={() => navigate('/dashboard/purchase/labour')}
            >
              {t('overview.perPlantBreakdown')}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                <path d="M5 12h14M13 6l6 6-6 6"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Sales + Purchase stacked */}
        <div className="col-span-12 lg:col-span-3 grid gap-5">
          {/* Sales — clickable card — blue (live BUSY data) */}
          <div
            className="card p-5 cursor-pointer hover:shadow-md transition-shadow"
            style={{ background: 'var(--blue-soft)', border: '1px solid #bfdbfe', position: 'relative' }}
            onClick={() => navigate('/dashboard/sales')}
          >
            <KpiInfoButton info={{ title: 'Sales MTD', what: 'Total sales invoiced to customers in the current calendar month, plus full FY revenue. Counts only non-cancelled sales vouchers.', source: 'BUSY DB', tables: ['Tran1'], dbPath: 'BusyFY2026 > dbo > Tables > Tran1', filter: 'VchType=9, Cancelled=0, current month / FY' }} />
            <div className="flex items-center justify-between mb-3">
              <div className="w-9 h-9 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 19V5M5 12l7-7 7 7"/>
                </svg>
              </div>
              <div className="chip text-xs">
                <span>{t('overview.mtdBusy')}</span>
              </div>
            </div>
            <div className="text-sm text-slate-500">{t('overview.salesFy')} {kpis ? fmtINR(kpis.fyRevenue) : ''}</div>
            <div className="text-[26px] font-extrabold text-blue-600 mt-1 leading-none num">
              {kpis ? fmtINR(kpis.salesMTD) : '…'}
            </div>
            <div className="text-xs text-slate-500 mt-1.5">
              <span className="text-slate-400">{kpis ? t('overview.invoicesFy', { count: kpis.salesInvoiceCount }) : ''}</span>
            </div>
          </div>

          {/* Purchase — clickable card — blue (live BUSY data) */}
          <div
            className="card p-5 cursor-pointer hover:shadow-md transition-shadow"
            style={{ background: 'var(--blue-soft)', border: '1px solid #bfdbfe', position: 'relative' }}
            onClick={() => navigate('/dashboard/purchase/far')}
          >
            <KpiInfoButton info={{ title: 'Purchase MTD', what: 'Total purchase amount paid to suppliers in the current month. Includes raw material and marine insurance. All plant purchases consolidated.', source: 'BUSY DB', tables: ['Tran1'], dbPath: 'BusyFY2026 > dbo > Tables > Tran1', filter: 'VchType=14, Cancelled=0, current month' }} />
            <div className="flex items-center justify-between mb-3">
              <div className="w-9 h-9 rounded-full bg-slate-100 text-slate-700 flex items-center justify-center">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 5v14M5 12l7 7 7-7"/>
                </svg>
              </div>
              <span className="badge" style={{ background: 'var(--blue-soft)', color: 'var(--blue)' }}>
                {t('overview.inclMarineIns')}
              </span>
            </div>
            <div className="text-sm text-slate-500">{t('overview.purchasePaidMtd')}</div>
            <div className="text-[26px] font-extrabold mt-1 leading-none num">
              {kpis ? fmtINR(kpis.purchaseMTD) : '…'}
            </div>
            <div className="text-orange-600 text-xs font-medium mt-2 flex items-center gap-1">
              {t('overview.allPurchaseModules')}
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                <path d="M5 12h14M13 6l6 6-6 6"/>
              </svg>
            </div>
          </div>
        </div>

        {/* Lock + Progress stacked — mock widgets, omitted on phones for breathing space */}
        <div className="hidden md:grid col-span-6 lg:col-span-2 gap-5">
          <div className="card p-5 flex flex-col items-center justify-center text-center" style={{ position: 'relative' }}>
            <KpiInfoButton info={{ title: 'System Lock Status', what: 'Indicates whether 2-step verification is active for the Admin role. When locked, sensitive actions require a second authentication step. This is a UI status indicator only.', source: 'Mock data', note: 'Dummy — not connected to any auth system. Future: read from Supabase auth or role config.' }} />
            <div className="w-11 h-11 rounded-full bg-slate-100 flex items-center justify-center mb-2">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="11" width="18" height="11" rx="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
            </div>
            <div className="text-sm font-semibold">{t('overview.systemLock')}</div>
            <div className="text-[11px] text-slate-500">{t('overview.twoStepOnForAdmin')}</div>
          </div>

          {/* Circular progress chart */}
          <div className="card p-3 flex flex-col items-center justify-center" style={{ position: 'relative' }}>
            <KpiInfoButton info={{ title: 'Quarterly Revenue Target', what: 'Progress ring showing 36% of the quarterly revenue target achieved so far. This is a placeholder / dummy widget — the target value and actual progress are hardcoded and not yet pulled from any data source.', source: 'Mock data', note: 'Dummy — hardcoded 36%. Future: set quarterly target in config, compute from BUSY Tran1 revenue.' }} />
            <svg width="120" height="120" viewBox="0 0 120 120">
              <circle cx="60" cy="60" r="48" fill="none" stroke="#0F172A" strokeWidth="14"/>
              <circle
                cx="60" cy="60" r="48" fill="none" stroke="#F47651" strokeWidth="14"
                strokeLinecap="round" strokeDasharray="301.6" strokeDashoffset="193"
                transform="rotate(-90 60 60)"
              />
              <text x="60" y="60" textAnchor="middle" fontWeight="800" fontSize="20" fill="#fff">36%</text>
              <text x="60" y="76" textAnchor="middle" fontSize="9" fill="#94A3B8">Target hit</text>
            </svg>
            <div className="text-[10px] text-slate-500 -mt-1 mb-1">{t('overview.quarterlyTarget')}</div>
          </div>
        </div>

        {/* Batches + Customer mini stacked */}
        <div className="col-span-12 lg:col-span-3 grid gap-5">
          {/* Active batches — clickable */}
          <div
            className="card p-5 cursor-pointer hover:shadow-md transition-shadow"
            style={{ position: 'relative' }}
            onClick={() => navigate('/dashboard/batches')}
          >
            <KpiInfoButton info={{ title: 'Active Batches', what: 'Count of CP manufacturing batches currently running across all factory plants, with average elapsed time. Click to open the full Batch Sheet.', source: 'Supabase', tables: ['active_batches'], filter: "status = 'active' · avg elapsed from started_at", note: 'The dot grid is a fixed visual status pattern, not live data.' }} />
            <div className="flex items-center justify-between mb-2">
              <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
                </svg>
              </div>
              <div className="text-[11px] text-slate-500">{t('overview.acrossFactories', { count: 4 })}</div>
            </div>
            <div className="text-[26px] font-extrabold leading-none">{t('overview.batchesCount', { count: activeBatchCount ?? 0 })}</div>
            <div className="text-[11px] text-slate-500 mb-3">
              {avgBatchHours != null
                ? t('overview.batchesRunningAvg', { hours: avgBatchHours })
                : t('overview.acrossFactories', { count: 4 })}
            </div>
            {/* Batch dot grid */}
            <div className="grid grid-cols-7 gap-1.5">
              {BATCH_GRID_PATTERN.slice(0, 35).map((s, i) => {
                const c = s === 3 ? '#F47651' : s === 2 ? '#FBC4AD' : '#E2E8F0';
                return (
                  <span
                    key={i}
                    className="rounded-sm"
                    style={{ background: c, aspectRatio: '1/1', display: 'block' }}
                  />
                );
              })}
            </div>
          </div>

          {/* Customer mini — blue (live BUSY data) */}
          <div className="card p-5" style={{ background: 'var(--blue-soft)', border: '1px solid #bfdbfe', position: 'relative' }}>
            <KpiInfoButton info={{ title: 'Customer History Snapshot', what: 'Top 3 customers ranked by MTD sales revenue, pulled live from BUSY. Shows how key accounts are performing this month.', source: 'BUSY DB', tables: ['Tran1', 'Master1'], dbPath: 'BusyFY2026 > dbo > Tables > Tran1\nBusyFY2026 > dbo > Tables > Master1', filter: 'VchType=9, Cancelled=0, TOP 3 by MTD revenue' }} />
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              {t('overview.customerHistorySnapshot')}
            </div>
            <div className="text-sm text-slate-500 mt-2">{t('overview.top3ByMtdRevenue')}</div>
            <div className="space-y-2 mt-2">
              {displayCustomers.map(c => (
                <div
                  key={c.name}
                  className="flex items-center justify-between py-1 border-b border-slate-50 last:border-0 cursor-pointer hover:bg-slate-50 rounded-lg px-1 -mx-1 transition-colors"
                  onClick={() => navigate('/dashboard/customers')}
                >
                  <div className="text-sm font-medium truncate pr-2">{c.name}</div>
                  <div className="text-sm font-bold num shrink-0">₹ {c.mtdVal}</div>
                </div>
              ))}
            </div>
            <button
              className="text-orange-600 text-xs font-semibold mt-3 flex items-center gap-1.5 hover:gap-2 transition-all"
              onClick={() => navigate('/dashboard/customers')}
            >
              {t('overview.openCustomerHistory')} →
            </button>
          </div>
        </div>
      </div>

      {/* ── Analytics Insight Row ── */}
      {analytics && (
        <div className="grid grid-cols-12 gap-5 mb-5">

          {/* DSO Gauge */}
          <div className="col-span-12 sm:col-span-6 lg:col-span-3 card p-5" style={{ position: 'relative' }}>
            <KpiInfoButton info={{ title: 'Days Sales Outstanding (DSO)', what: 'How many days on average it takes to collect payment after a sale is made. Lower is better — below 30d is best-in-class.', source: 'Derived', formula: 'DSO = (Debtors Outstanding / FY Revenue) × 365', tables: ['DailySum', 'Master1', 'Tran1'], dbPath: 'BusyFY2026 > dbo > Tables > DailySum\nBusyFY2026 > dbo > Tables > Master1', note: 'Debtors = Master1 WHERE ParentGrp=116. Target < 30 days.' }} />
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
          <div className="col-span-12 sm:col-span-6 lg:col-span-3 card p-5" style={{ position: 'relative' }}>
            <KpiInfoButton info={{ title: 'Gross Margin %', what: 'Percentage of FY revenue remaining after subtracting total purchases. Measures operational profitability before overheads.', source: 'Derived', formula: 'Gross Margin = (FY Revenue − FY Purchase) / FY Revenue × 100', tables: ['Tran1'], dbPath: 'BusyFY2026 > dbo > Tables > Tran1', filter: 'VchType=9 (Sales), VchType=14 (Purchase)', note: 'Industry benchmark for chemical mfg is ~28%.' }} />
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
          <div className="col-span-12 lg:col-span-3 card p-5" style={{ position: 'relative' }}>
            <KpiInfoButton info={{ title: 'Annualised Revenue Run Rate', what: 'Projects full-year revenue based on the average of the last 2 complete months. Useful to spot whether the business is growing or contracting in real time.', source: 'Derived', formula: 'Run Rate = avg(last 2 complete months revenue) × 12', tables: ['Tran1'], dbPath: 'BusyFY2026 > dbo > Tables > Tran1', filter: 'VchType=9, Cancelled=0, GROUP BY month' }} />
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
          <div className="col-span-12 lg:col-span-3 card p-5" style={{ position: 'relative' }}>
            <KpiInfoButton info={{ title: 'Net Working Capital', what: 'Total debtors outstanding minus total creditors outstanding. Positive = company holds more receivables than payables. Negative = creditors exceed debtors (short-term liquidity risk).', source: 'Derived', formula: 'NWC = Debtors Outstanding − Creditors Outstanding', tables: ['DailySum', 'Master1'], dbPath: 'BusyFY2026 > dbo > Tables > DailySum\nBusyFY2026 > dbo > Tables > Master1', note: 'Debtors: ParentGrp=116 · Creditors: ParentGrp=117' }} />
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
        <div className="grid grid-cols-12 gap-5 mb-5">

          {/* DPO + Cash Conversion Cycle */}
          <div className="col-span-12 sm:col-span-6 lg:col-span-3 card p-5" style={{ background: 'var(--blue-soft)', border: '1px solid #BFDBFE', position: 'relative' }}>
            <KpiInfoButton info={{ title: 'DPO & Cash Conversion Cycle', what: 'DPO = how many days before the company pays its suppliers. CCC = DSO minus DPO — negative means cash-positive (collect before you pay). Very favourable for working capital.', source: 'Derived', formula: 'DPO = (Creditors Outstanding / FY Purchase) × 365\nCCC = DSO − DPO', tables: ['DailySum', 'Master1', 'Tran1'], dbPath: 'BusyFY2026 > dbo > Tables > DailySum\nBusyFY2026 > dbo > Tables > Master1', note: 'Creditors: Master1 WHERE ParentGrp=117' }} />
            <div className="text-[11px] text-slate-500 uppercase tracking-wider mb-1">{t('overview.payablesCycleDpo')}</div>
            <div className="text-[28px] font-extrabold num text-blue-700">{analytics.dpo} d</div>
            <div className="text-[11px] text-slate-500 mt-0.5">{t('overview.daysPayableOutstanding')}</div>
            <div className="mt-3 pt-3 border-t border-blue-100">
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
          <div className="col-span-12 sm:col-span-6 lg:col-span-3 card p-5" style={{ background: 'var(--blue-soft)', border: '1px solid #BFDBFE', position: 'relative' }}>
            <KpiInfoButton info={{ title: 'Collection Ratio MTD', what: 'Percentage of this month\'s sales revenue that has already been received as cash. 100% = all invoices collected. Lower % = paper revenue not yet turned into cash.', source: 'Derived', formula: 'Collection Ratio = MTD Receipts / MTD Sales × 100', tables: ['Tran1'], dbPath: 'BusyFY2026 > dbo > Tables > Tran1', filter: 'Receipts: VchType=16 · Sales: VchType=9, current month' }} />
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
          <div className="col-span-12 lg:col-span-3 card p-5" style={{ background: 'var(--blue-soft)', border: '1px solid #BFDBFE', position: 'relative' }}>
            <KpiInfoButton info={{ title: 'Overdue Aging Buckets', what: 'Outstanding bills broken into 4 age bands: 1-30 days, 31-60 days, 61-90 days, and 90+ days overdue. Older buckets have higher collection risk — chemicals businesses rarely recover >90d debt.', source: 'BUSY DB', tables: ['Tran3'], dbPath: 'BusyFY2026 > dbo > Tables > Tran3', filter: 'RecType=5, Status=1 (pending), DueDate < today', note: 'Status is a smallint: 1 = pending, not the string "pending".' }} />
            <div className="flex items-center justify-between mb-3">
              <div className="text-[11px] text-slate-500 uppercase tracking-wider">{t('overview.overdueAging')}</div>
              <div className="text-[11px] font-bold text-red-600">
                {fmtINR(analytics.overdueAging.d1_30 + analytics.overdueAging.d31_60 + analytics.overdueAging.d61_90 + analytics.overdueAging.d90plus)} {t('overview.total')}
              </div>
            </div>
            <OverdueAgingBar aging={analytics.overdueAging} />
          </div>

          {/* Revenue vs Cash Gap */}
          <div className="col-span-12 lg:col-span-3 card p-5" style={{ background: 'var(--blue-soft)', border: '1px solid #BFDBFE', position: 'relative' }}>
            <KpiInfoButton info={{ title: 'Revenue vs Cash Received Gap', what: 'FY revenue invoiced minus FY receipts actually received. This gap is the total amount still owed across all customers — the difference between accounting revenue and real cash.', source: 'Derived', formula: 'Gap = FY Revenue − FY Receipts (VchType=16)', tables: ['Tran1'], dbPath: 'BusyFY2026 > dbo > Tables > Tran1', filter: 'Revenue: VchType=9 · Receipts: VchType=16, Cancelled=0' }} />
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

      {/* ── Movements + Modules + Alerts ── */}
      <div className="grid grid-cols-12 gap-5 mb-5">

        {/* Movements feed — green-soft */}
        <div className="col-span-12 lg:col-span-5 card p-6" style={{ background: 'var(--green-soft)', border: '1px solid #bbf7d0', position: 'relative' }}>
          <KpiInfoButton info={{ title: "Today's Movements Feed", what: 'Real-time activity feed showing all sales, purchase, batch, stock, and maintenance events from the last 3 days. Each entry is logged once (in the relevant module) and automatically appears here. Click any row to navigate to the source module.', source: 'BUSY DB', tables: ['Tran1', 'Master1'], dbPath: 'BusyFY2026 > dbo > Tables > Tran1\nBusyFY2026 > dbo > Tables > Master1', filter: 'VchType in (9,14,16,19), last 3 days', note: 'Batch, stock, and maintenance events currently from mock data.' }} />
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <div className="text-base font-bold">{t('overview.todaysMovements')}</div>
            </div>
          </div>

          {/* Search */}
          <div className="relative mb-3">
            <input
              value={moveSearch}
              onChange={e => setMoveSearch(e.target.value)}
              placeholder={t('overview.searchMovesPlaceholder')}
              className="pl-11 pr-4 py-2.5 w-full bg-slate-50 hover:bg-white border border-transparent hover:border-slate-200 rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-orange-200 transition"
            />
            <svg className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
                {f === 'purchase' && <span className="dot"></span>}
                <span>{t(`overview.movefilter_${f}`)}</span>
              </div>
            ))}
          </div>

          {/* List — items navigate to relevant section */}
          <div className="space-y-2.5 max-h-[420px] overflow-y-auto pr-1">
            {filteredMoves.length > 0 ? filteredMoves.map((m, i) => (
              <div
                key={i}
                className="flex items-center gap-3 p-3 rounded-2xl border border-slate-100 hover:border-slate-200 hover:bg-slate-50 cursor-pointer transition"
                onClick={() => navigate(MOVE_ROUTE[m.type] ?? '/dashboard')}
              >
                <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: '#F1F5F9', color: '#475569' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="9"/>
                  </svg>
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

        {/* Modules card */}
        <div className="col-span-12 lg:col-span-4 card p-6" style={{ position: 'relative' }}>
          <KpiInfoButton info={{ title: 'Modules Directory', what: 'Quick navigation to all operational modules in the dashboard. Badge counts are live: Purchase shows pending store requisitions, Batch Sheet shows active batches. Modules with no live count show no badge.', source: 'Supabase', tables: ['store_requisitions', 'active_batches'], filter: "store_requisitions.status='pending' · active_batches.status='active'" }} />
          <div className="flex items-center justify-between mb-2">
            <div>
              <div className="text-base font-bold">{t('overview.modules')}</div>
              <div className="text-xs text-slate-500">
                {t('overview.modulesPurchaseHint')}
              </div>
            </div>
          </div>
          <div className="space-y-1 mt-3">
            {MODULES.map(m => (
              <button
                key={m.name}
                className="w-full flex items-center gap-4 px-3 py-3 rounded-2xl text-left transition hover:bg-slate-50"
                onClick={() => {
                  if (m.page === 'purchase') navigate('/dashboard/purchase/far');
                  else if (m.page === 'sales') navigate('/dashboard/sales');
                  else if (m.page === 'stock') navigate('/dashboard/stock');
                  else if (m.page === 'batch') navigate('/dashboard/batches');
                  else if (m.page === 'customers') navigate('/dashboard/customers');
                  else if (m.page === 'nightmgr') navigate('/dashboard/night-manager');
                }}
              >
                <div
                  className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0"
                  style={m.accent ? { background: '#F47651', color: '#fff' } : { background: '#F1F5F9', color: '#475569' }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="9"/>
                  </svg>
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <div className="font-semibold text-sm">{m.name}</div>
                    {m.countKey && moduleCounts[m.countKey] ? (
                      <span className="badge" style={{ background: 'var(--accent-soft)', color: 'var(--accent-deep)' }}>
                        {t('overview.openCount', { count: moduleCounts[m.countKey] as number })}
                      </span>
                    ) : null}
                  </div>
                  <div className="text-xs text-slate-500">{m.sub}</div>
                </div>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="2.4">
                  <path d="m9 6 6 6-6 6"/>
                </svg>
              </button>
            ))}
          </div>
        </div>

        <AlertsPanel alerts={alerts} onNavigate={(route) => navigate(route)} />
      </div>

      <StockSnapshot
        densities={densities}
        locations={locations}
        matrix={matrix}
        tanks={tanks}
        onOpenStock={() => navigate('/dashboard/stock')}
      />

      {/* Toast element */}
      <div id="sk-toast" className="toast">{t('overview.actionRecorded')}</div>

      <VoiceSearch open={voiceOpen} onClose={() => setVoiceOpen(false)} />
    </>
  );
}
