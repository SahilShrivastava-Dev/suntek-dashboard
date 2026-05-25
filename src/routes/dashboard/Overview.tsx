import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  MOVEMENTS, ALERTS, MODULES, CUSTOMERS, TANKS, CP_LOCATIONS, CP_DENSITIES,
  CP_MATRIX, BATCH_GRID_PATTERN
} from '../../data/mockData';

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

/** Map ALERTS.who → dashboard route for direct navigation */
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

export function Overview() {
  const navigate = useNavigate();
  const [moveFilter, setMoveFilter] = useState('all');
  const [moveSearch, setMoveSearch] = useState('');

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

  const filteredMoves = MOVEMENTS
    .filter(m => moveFilter === 'all' || m.type === moveFilter)
    .filter(m => (m.title + m.sub).toLowerCase().includes(moveSearch.toLowerCase()));

  const topCustomers = CUSTOMERS.slice(0, 3);

  const sevColor: Record<string, string> = { red: '#DC2626', amber: '#D97706', low: '#475569' };

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
              <span>Pending approvals</span>
              <span className="bg-white/20 text-white text-[11px] font-bold px-2 py-0.5 rounded-full">7</span>
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
                <span>{company === 'All' ? 'All companies' : company}</span>
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
                      {c === 'All' ? 'All companies' : c}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Voice / greeting */}
          <div className="flex items-center gap-3 flex-1 justify-end min-w-[260px]">
            <div className="text-right">
              <div className="serif text-[24px] md:text-[30px] leading-[1]">Hey, what's happening today?</div>
              <div className="text-slate-400 text-[13px]">Ask anything across purchase, sales, stock, batch.</div>
            </div>
            <button
              className="w-12 h-12 rounded-full bg-white border border-slate-200 hover:border-orange-300 hover:bg-orange-50 flex items-center justify-center transition"
              onClick={() => toast('Voice input ready')}
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

        {/* All Companies card — green-soft */}
        <div className="col-span-12 lg:col-span-4 card p-6" style={{ background: 'var(--green-soft)', border: '1px solid #bbf7d0' }}>
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
          <div className="text-slate-500 text-sm">Linked to all godowns and Busy</div>
          <div className="serif text-[40px] leading-[1] mt-2 mb-5">All companies</div>
          <div className="grid grid-cols-2 gap-3 mb-5">
            <button
              className="btn-dark pill py-3 font-semibold text-sm flex items-center justify-center gap-2"
              onClick={() => navigate('/dashboard/purchase/storereq')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M20 6 9 17l-5-5"/>
              </svg>
              Approve <span className="bg-white/15 px-1.5 rounded">7</span>
            </button>
            <button
              className="btn-ghost pill py-3 font-semibold text-sm flex items-center justify-center gap-2"
              onClick={() => navigate('/dashboard/purchase/storereq')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="m18.5 2.5 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
              Review
            </button>
          </div>
          <div className="flex items-end justify-between border-t border-slate-100 pt-4">
            <div>
              <div className="text-xs text-slate-500">Today's labour cost</div>
              <div className="text-xl font-bold mt-0.5 num">₹ 2,84,500</div>
            </div>
            <button
              className="text-orange-600 font-medium text-xs flex items-center gap-1.5 hover:gap-2 transition-all"
              onClick={() => navigate('/dashboard/purchase/labour')}
            >
              Per-plant breakdown
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                <path d="M5 12h14M13 6l6 6-6 6"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Sales + Purchase stacked */}
        <div className="col-span-12 lg:col-span-3 grid gap-5">
          {/* Sales — clickable card */}
          <div
            className="card p-5 cursor-pointer hover:shadow-md transition-shadow"
            style={{ background: 'var(--red-soft)', border: '1px solid #fecaca' }}
            onClick={() => navigate('/dashboard/sales')}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="w-9 h-9 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 19V5M5 12l7-7 7 7"/>
                </svg>
              </div>
              <div className="chip text-xs">
                <span>This week</span>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                  <path d="m6 9 6 6 6-6"/>
                </svg>
              </div>
            </div>
            <div className="text-sm text-slate-500">Sales (Busy + system)</div>
            <div className="text-[26px] font-extrabold text-orange-600 mt-1 leading-none num">₹ 23,19,480</div>
            <div className="text-xs text-slate-500 mt-1.5">
              <span className="text-green-600 font-semibold">↑ 12.4%</span> vs last week
            </div>
          </div>

          {/* Purchase — clickable card */}
          <div
            className="card p-5 cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => navigate('/dashboard/purchase/far')}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="w-9 h-9 rounded-full bg-slate-100 text-slate-700 flex items-center justify-center">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 5v14M5 12l7 7 7-7"/>
                </svg>
              </div>
              <span className="badge" style={{ background: 'var(--blue-soft)', color: 'var(--blue)' }}>
                incl. Marine ins.
              </span>
            </div>
            <div className="text-sm text-slate-500">RM purchase paid</div>
            <div className="text-[26px] font-extrabold mt-1 leading-none num">₹ 8,14,520</div>
            <div className="text-orange-600 text-xs font-medium mt-2 flex items-center gap-1">
              All purchase modules
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                <path d="M5 12h14M13 6l6 6-6 6"/>
              </svg>
            </div>
          </div>
        </div>

        {/* Lock + Progress stacked */}
        <div className="col-span-6 lg:col-span-2 grid gap-5">
          <div className="card p-5 flex flex-col items-center justify-center text-center">
            <div className="w-11 h-11 rounded-full bg-slate-100 flex items-center justify-center mb-2">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="11" width="18" height="11" rx="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
            </div>
            <div className="text-sm font-semibold">System Lock</div>
            <div className="text-[11px] text-slate-500">2-step on for Admin</div>
          </div>

          {/* Circular progress chart */}
          <div className="card p-3 flex flex-col items-center justify-center">
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
            <div className="text-[10px] text-slate-500 -mt-1 mb-1">Quarterly target</div>
          </div>
        </div>

        {/* Batches + Customer mini stacked */}
        <div className="col-span-12 lg:col-span-3 grid gap-5">
          {/* Active batches — clickable */}
          <div
            className="card p-5 cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => navigate('/dashboard/batches')}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
                </svg>
              </div>
              <div className="text-[11px] text-slate-500">Across 4 factories</div>
            </div>
            <div className="text-[26px] font-extrabold leading-none">7 batches</div>
            <div className="text-[11px] text-slate-500 mb-3">running, avg 41h elapsed</div>
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

          {/* Customer mini */}
          <div className="card p-5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Customer history snapshot
            </div>
            <div className="text-sm text-slate-500 mt-2">Top 3 by MTD value</div>
            <div className="space-y-2 mt-2">
              {topCustomers.map(c => (
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
              Open Customer History →
            </button>
          </div>
        </div>
      </div>

      {/* ── Movements + Modules + Alerts ── */}
      <div className="grid grid-cols-12 gap-5 mb-5">

        {/* Movements feed — green-soft */}
        <div className="col-span-12 lg:col-span-5 card p-6" style={{ background: 'var(--green-soft)', border: '1px solid #bbf7d0' }}>
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <div className="text-base font-bold">Today's movements</div>
              <button
                className="ml-1 w-6 h-6 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center"
                onClick={() => toast('Logged once, visible everywhere')}
              >
                <span className="text-xs font-bold text-slate-500">i</span>
              </button>
            </div>
          </div>

          {/* Search */}
          <div className="relative mb-3">
            <input
              value={moveSearch}
              onChange={e => setMoveSearch(e.target.value)}
              placeholder="Search a batch, dispatch, party …"
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
                <span>{f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1) + (f === 'maint' ? '.' : '')}</span>
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
              <div className="text-center py-10 text-slate-400 text-sm">No movements match.</div>
            )}
          </div>
        </div>

        {/* Modules card */}
        <div className="col-span-12 lg:col-span-4 card p-6">
          <div className="flex items-center justify-between mb-2">
            <div>
              <div className="text-base font-bold">Modules</div>
              <div className="text-xs text-slate-500">
                Purchase now contains FAR · Maintenance · Activity Log · Store Req · POs · Marine Ins. · Labour
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
                    {m.pending && (
                      <span className="badge" style={{ background: 'var(--accent-soft)', color: 'var(--accent-deep)' }}>
                        {m.pending} open
                      </span>
                    )}
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

        {/* Alerts card — items navigate to relevant section */}
        <div className="col-span-12 lg:col-span-3 card p-6">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-base font-bold">Open alerts</div>
              <div className="text-xs text-slate-500">Click to navigate · real-time</div>
            </div>
            <span className="badge" style={{ background: 'var(--red-soft)', color: 'var(--red)' }}>7 open</span>
          </div>
          <div className="space-y-2.5">
            {ALERTS.map((a, i) => {
              const route = ALERT_ROUTE[a.who];
              return (
                <div
                  key={i}
                  className={`flex items-center gap-3 p-2.5 rounded-2xl hover:bg-slate-50 transition-colors ${route ? 'cursor-pointer' : ''}`}
                  onClick={() => route && navigate(route)}
                >
                  <div
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ background: sevColor[a.sev] || sevColor.low }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm leading-tight">{a.text}</div>
                    <div className="text-[11px] text-slate-400">{a.who} · {a.when}</div>
                  </div>
                  {route && (
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#CBD5E1" strokeWidth="2.4">
                      <path d="m9 6 6 6-6 6"/>
                    </svg>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Stock snapshot ── */}
      <div className="grid grid-cols-12 gap-5 mb-5">
        {/* CPM Matrix — green-soft */}
        <div className="col-span-12 lg:col-span-7 card p-6" style={{ background: 'var(--green-soft)', border: '1px solid #bbf7d0' }}>
          <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
            <div>
              <div className="text-base font-bold">CPM Stock · density × location</div>
              <div className="text-xs text-slate-500">Drums on hand, live · cell shading shows relative volume</div>
            </div>
            <button
              className="btn-outline pill px-3 py-2 text-xs font-semibold"
              onClick={() => navigate('/dashboard/stock')}
            >
              Open Stock →
            </button>
          </div>
          <div className="overflow-x-auto scroll-x">
            <table className="dt">
              <thead>
                <tr>
                  <th>Location</th>
                  {CP_DENSITIES.map(d => (
                    <th key={d} className="num">d {d}</th>
                  ))}
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {CP_LOCATIONS.map(loc => {
                  const row = CP_MATRIX[loc];
                  const total = row.reduce((a, b) => a + b, 0);
                  return (
                    <tr key={loc}>
                      <td className="font-semibold">{loc}</td>
                      {row.map((v, i) => {
                        const intensity = Math.min(v / 400, 1);
                        return (
                          <td key={i} className="num">
                            <span style={{ background: `rgba(244,118,81,${intensity * 0.28})`, padding: '3px 10px', borderRadius: '8px' }}>
                              {v}
                            </span>
                          </td>
                        );
                      })}
                      <td className="num font-bold">{total}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Tank levels — each card navigates to Stock page */}
        <div className="col-span-12 lg:col-span-5 card p-6">
          <div className="text-base font-bold">Tank levels · port + factory</div>
          <div className="text-xs text-slate-500 mb-4">Click any tank to open full stock view</div>
          <div className="space-y-2.5">
            {TANKS.map(tk => {
              const color = tk.alert ? '#DC2626' : tk.level > 70 ? '#16A34A' : tk.level > 30 ? '#F47651' : '#D97706';
              return (
                <div
                  key={tk.name}
                  className="p-2.5 rounded-2xl border border-slate-100 hover:bg-slate-50 cursor-pointer hover:border-slate-200 transition-colors"
                  onClick={() => navigate('/dashboard/stock')}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <div>
                      <div className="font-semibold text-sm">{tk.name}</div>
                      <div className="text-[11px] text-slate-500">{tk.loc} · cap {tk.cap} {tk.unit}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold num text-sm">{Math.round(tk.cap * tk.level / 100)} {tk.unit}</div>
                      <div className="text-[11px] font-semibold" style={{ color }}>
                        {tk.level}%{tk.alert ? ' · low' : ''}
                      </div>
                    </div>
                  </div>
                  <div className="progress" style={{ height: '6px' }}>
                    <div style={{ width: `${tk.level}%`, background: color }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Toast element */}
      <div id="sk-toast" className="toast">Action recorded</div>
    </>
  );
}
