import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { AuthUser } from '../../hooks/useAuth';
import { useRoleContext } from '../../contexts/RoleContext';
import { useAnomalies } from '../../contexts/AnomalyContext';
import { useSearchPalette } from '../../contexts/SearchPaletteContext';
import { profileCanAccess } from '../../lib/profiles';

interface SidebarProps {
  user: AuthUser | null;
  onSignOut: () => void;
  /** Drawer open state on mobile (md+ is always shown). */
  mobileOpen?: boolean;
  /** Close the mobile drawer (called after navigation). */
  onClose?: () => void;
}

/**
 * Purchase sub-tabs — order matters (first visible tab is the accordion default).
 * Each tab maps to /dashboard/purchase/{tab}. `key` is the i18n label key.
 */
const PURCHASE_TABS = [
  { key: 'nav.far',            tab: 'far'      },
  { key: 'nav.maintenance',    tab: 'maint'     },
  { key: 'nav.activityLog',    tab: 'activity'  },
  { key: 'nav.storeReq',       tab: 'storereq'  },
  { key: 'nav.purchaseOrders', tab: 'purchase'  },
];

// ── Icons ─────────────────────────────────────────────────────────────────────

function IconGrid() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="7" height="7" rx="1.5"/>
      <rect x="14" y="3" width="7" height="7" rx="1.5"/>
      <rect x="3" y="14" width="7" height="7" rx="1.5"/>
      <rect x="14" y="14" width="7" height="7" rx="1.5"/>
    </svg>
  );
}
function IconBox() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
    </svg>
  );
}
function IconCart() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
      <path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6"/>
    </svg>
  );
}
function IconStock() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
      <path d="M3.27 6.96 12 12.01l8.73-5.05M12 22V12"/>
    </svg>
  );
}
function IconFlask() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9 3h6"/><path d="M10 3v6L4 21h16L14 9V3"/>
    </svg>
  );
}
function IconUsers() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  );
}
function IconMoon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
    </svg>
  );
}
function IconFile() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4.5 3h15"/><path d="M6 3v16a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V3"/>
      <path d="M6 14h12"/>
    </svg>
  );
}
function IconAudit() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>
    </svg>
  );
}
function IconUserPlus() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <line x1="19" y1="8" x2="19" y2="14"/><line x1="16" y1="11" x2="22" y2="11"/>
    </svg>
  );
}
function IconBan() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10"/>
      <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
    </svg>
  );
}
function IconSearch() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
      <circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>
    </svg>
  );
}
function IconWarehouse() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
      <polyline points="9 22 9 12 15 12 15 22"/>
    </svg>
  );
}
function IconBatch() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3"/>
      <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/>
    </svg>
  );
}
function IconAlert() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
      <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
  );
}
function IconClipboard() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
      <rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>
      <line x1="9" y1="12" x2="15" y2="12"/>
      <line x1="9" y1="16" x2="13" y2="16"/>
    </svg>
  );
}
function IconActivity() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
    </svg>
  );
}

// ── Section header ─────────────────────────────────────────────────────────────

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mt-6 mb-2 px-3">
      {label}
    </div>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

export function Sidebar({ user, onSignOut, mobileOpen = false, onClose }: SidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const { activeProfile, can } = useRoleContext();
  const { criticalCount } = useAnomalies();
  const { openPalette } = useSearchPalette();

  const [purchaseOpen, setPurchaseOpen] = useState(
    location.pathname.startsWith('/dashboard/purchase')
  );

  // Monitoring "Intelligence" accordion holds the analytical pages; Anomaly
  // Detection sits outside it as a peer. Open by default when on any of them.
  const MONITORING_PATHS = [
    '/dashboard/predictive-qc',
    '/dashboard/cost-intelligence',
    '/dashboard/working-capital',
    '/dashboard/benchmarking',
    '/dashboard/owner',
    '/dashboard/anomaly-center',
  ];
  const [monitoringOpen, setMonitoringOpen] = useState(
    MONITORING_PATHS.some((p) => location.pathname.startsWith(p))
  );

  // Technical Team (factory_operator) navigates via 3 dropdowns: Batch / Operations / Logs.
  const isOperator = activeProfile.id === 'factory_operator';
  const [batchOpen, setBatchOpen] = useState(true);
  const [opsOpen, setOpsOpen] = useState(
    location.pathname === '/dashboard/batches' || location.pathname === '/dashboard/stock'
  );
  const [logsOpen, setLogsOpen] = useState(location.pathname === '/dashboard/daily-log');

  /** True if the active profile can access this exact route (or its children). */
  const canSee = (route: string) => profileCanAccess(activeProfile, route);

  // Purchase: only show tabs the active role is allowed to see
  const visiblePurchaseTabs = PURCHASE_TABS.filter((pt) =>
    canSee(`/dashboard/purchase/${pt.tab}`)
  );

  // ── Section visibility ──────────────────────────────────────────────────────
  //
  // WORKSPACE  =  Overview + Purchase accordion
  // OPERATIONS =  Batch Sheet · Night Manager board · CPM Stock · Warehouse App
  // FINANCE    =  Sales · Customer History
  // REFERENCE  =  Oil Ratio Table · Audit Log
  //
  // CPM Stock is OPERATIONS (physical inventory) not Finance.
  // Marine Insurance and Labour in Purchase are Finance; they're filtered per-role.

  const showOverview  = canSee('/dashboard');
  const showPurchase  = visiblePurchaseTabs.length > 0;

  // Workspace section header — only if at least one workspace item is visible
  const showWorkspace = showOverview || showPurchase;

  // Operations items
  const showBatches      = canSee('/dashboard/batches');
  const showNightMgr     = canSee('/dashboard/night-manager');
  const showStock        = canSee('/dashboard/stock');   // CPM Stock = operational inventory

  // L1 entry views — shown ONLY for the specific role that owns the task.
  // Admin/Unit Head monitor via boards (Batch Sheet, Night Manager, CPM Stock) — not entry terminals.
  // Accountants do not see operations — they only access Finance and Reference sections.
  const isAccountant = activeProfile.id === 'accountant_delhi' || activeProfile.id === 'accountant_other';
  const showWarehouseEntry = activeProfile.id === 'warehouse_manager';
  const showNightEntry     = activeProfile.id === 'night_manager';
  const showBatchEntry     = activeProfile.id === 'factory_operator';
  // Daily log upload: admin + unit_head only. The Technical Team (factory_operator)
  // is the Batch Logger — their only job is "Log Reading" (batch-entry), and
  // /dashboard/daily-log isn't in their allowed routes, so it must not appear.
  const showDailyLog = ['admin','unit_head'].includes(activeProfile.id);

  const showOperations = !isAccountant && (showBatches || showNightMgr || showStock || showWarehouseEntry || showNightEntry || showBatchEntry || showDailyLog);

  // Finance items
  const showSales     = canSee('/dashboard/sales');
  const showCustomers = canSee('/dashboard/customers');
  const showFinance   = showSales || showCustomers;

  // Reference items
  const showOilRatio = canSee('/dashboard/oil-ratio');
  const showAudit    = canSee('/dashboard/audit');
  const showReference = showOilRatio || showAudit;

  // Monitoring items
  const showAnomalies = canSee('/dashboard/anomalies');
  const showOwner = activeProfile.id === 'admin';

  // Intelligence accordion sub-tabs — order matters (first visible is the
  // accordion default target). Anomaly Detection is intentionally NOT here;
  // it stays a peer of the accordion below.
  const INTELLIGENCE_TABS = [
    { key: 'nav.predictiveQc',      path: '/dashboard/predictive-qc',     show: canSee('/dashboard/predictive-qc')     },
    { key: 'nav.costMargin',        path: '/dashboard/cost-intelligence', show: canSee('/dashboard/cost-intelligence') },
    { key: 'nav.workingCapital',    path: '/dashboard/working-capital',   show: canSee('/dashboard/working-capital')   },
    { key: 'nav.benchmarking',      path: '/dashboard/benchmarking',      show: canSee('/dashboard/benchmarking')      },
    { key: 'nav.ownerIntelligence', path: '/dashboard/owner',             show: showOwner                              },
    { key: 'nav.anomalyCenter',     path: '/dashboard/anomaly-center',    show: canSee('/dashboard/anomaly-center')    },
  ].filter((it) => it.show);

  const showIntelligence = INTELLIGENCE_TABS.length > 0;

  // Admin section — user management + blacklist
  // User Management shows for anyone who can manage users or roles (delegated too).
  const showAdmin = can('manage_users') || can('manage_roles');
  const showBlacklist = activeProfile.id === 'admin' || activeProfile.id === 'unit_head';

  const isActive = (path: string) => {
    if (path === '/dashboard') return location.pathname === '/dashboard';
    return location.pathname.startsWith(path);
  };

  // Batch logger tab (?tab=) — used to highlight the operator's Batch/Logs sub-items.
  const currentTab = new URLSearchParams(location.search).get('tab') || 'reading';
  const isBatchTab = (t: string) =>
    location.pathname === '/dashboard/batch-entry' && currentTab === t;

  function navTo(path: string) {
    navigate(path);
    onClose?.(); // close the mobile drawer after navigating
  }

  return (
    <aside
      className={`fixed left-0 top-0 bottom-0 bg-white border-r border-slate-100 p-5 overflow-y-auto z-50 transition-transform duration-200 md:translate-x-0 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}
      style={{ width: '260px' }}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 mb-7">
        <div className="w-11 h-11 rounded-2xl bg-slate-900 text-white flex items-center justify-center font-extrabold text-lg shadow-sm">
          S°
        </div>
        <div>
          <div className="font-extrabold text-[15px] leading-tight">Suntek Group</div>
          <div className="text-slate-400 text-[11px]">CaratSense · v0.2</div>
        </div>
      </div>

      {/* Quick Search */}
      <button
        className="btn-accent pill px-4 py-2.5 font-semibold text-[13px] flex items-center gap-2 mb-2 w-full justify-center"
        onClick={() => { openPalette(); onClose?.(); }}
      >
        <IconSearch />
        <span>{t('nav.quickSearch')}</span>
        <kbd className="bg-white/15 border-white/15 text-white">⌘ K</kbd>
      </button>

      {/* ── WORKSPACE ─────────────────────────────────────────────────────── */}
      {showWorkspace && <SectionHeader label={t('section.workspace')} />}
      <nav className="flex flex-col gap-1">

        {/* Overview */}
        {showOverview && (
          <a
            className={`nav-link${location.pathname === '/dashboard' ? ' active' : ''}`}
            onClick={() => navTo('/dashboard')}
          >
            <IconGrid />
            <span>{t('nav.overview')}</span>
          </a>
        )}

        {/* Purchase accordion — only purchase tabs this role can access */}
        {showPurchase && (
          <>
            <a
              className={`nav-link${isActive('/dashboard/purchase') ? ' active' : ''}`}
              onClick={() => {
                setPurchaseOpen((o) => !o);
                if (!purchaseOpen) navTo(`/dashboard/purchase/${visiblePurchaseTabs[0].tab}`);
              }}
            >
              <IconBox />
              <span>{t('nav.purchase')}</span>
              <svg
                className="ml-auto transition-transform duration-200"
                style={{ transform: purchaseOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}
                width="11" height="11" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2.4"
              >
                <path d="m9 6 6 6-6 6"/>
              </svg>
            </a>

            {purchaseOpen && (
              <div className="nav-sub">
                {visiblePurchaseTabs.map((pt) => (
                  <a
                    key={pt.tab}
                    className={`nav-link${
                      location.pathname === `/dashboard/purchase/${pt.tab}` ? ' active' : ''
                    }`}
                    onClick={() => navTo(`/dashboard/purchase/${pt.tab}`)}
                  >
                    {t(pt.key)}
                  </a>
                ))}
              </div>
            )}
          </>
        )}
      </nav>

      {/* ── OPERATIONS ────────────────────────────────────────────────────── */}
      {showOperations && <SectionHeader label={t('section.operations')} />}

      {/* Technical Team: 3 dropdowns (Batch / Operations / Logs) like the Purchase accordion */}
      {isOperator ? (
      <nav className="flex flex-col gap-1">

        {/* Batch dropdown */}
        <a
          className={`nav-link${location.pathname === '/dashboard/batch-entry' ? ' active' : ''}`}
          onClick={() => { setBatchOpen((o) => !o); if (!batchOpen) navTo('/dashboard/batch-entry?tab=reading'); }}
        >
          <IconBatch />
          <span>{t('nav.batch')}</span>
          <svg className="ml-auto transition-transform duration-200" style={{ transform: batchOpen ? 'rotate(90deg)' : 'rotate(0deg)' }} width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="m9 6 6 6-6 6"/></svg>
        </a>
        {batchOpen && (
          <div className="nav-sub">
            <a className={`nav-link${isBatchTab('reading') ? ' active' : ''}`} onClick={() => navTo('/dashboard/batch-entry?tab=reading')}>{t('nav.logReading')}</a>
            <a className={`nav-link${isBatchTab('new-batch') ? ' active' : ''}`} onClick={() => navTo('/dashboard/batch-entry?tab=new-batch')}>{t('nav.newBatch')}</a>
            <a className={`nav-link${isBatchTab('upload') ? ' active' : ''}`} onClick={() => navTo('/dashboard/batch-entry?tab=upload')}>{t('nav.uploadBatchSheet')}</a>
          </div>
        )}

        {/* Operations dropdown */}
        <a
          className={`nav-link${(isActive('/dashboard/batches') || isActive('/dashboard/stock')) ? ' active' : ''}`}
          onClick={() => { setOpsOpen((o) => !o); if (!opsOpen) navTo('/dashboard/batches'); }}
        >
          <IconFlask />
          <span>{t('nav.operations')}</span>
          <svg className="ml-auto transition-transform duration-200" style={{ transform: opsOpen ? 'rotate(90deg)' : 'rotate(0deg)' }} width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="m9 6 6 6-6 6"/></svg>
        </a>
        {opsOpen && (
          <div className="nav-sub">
            <a className={`nav-link${isActive('/dashboard/batches') ? ' active' : ''}`} onClick={() => navTo('/dashboard/batches')}>{t('nav.batchSheet')}</a>
            <a className={`nav-link${isActive('/dashboard/stock') ? ' active' : ''}`} onClick={() => navTo('/dashboard/stock')}>{t('nav.cpmStock')}</a>
          </div>
        )}

        {/* Logs dropdown */}
        <a
          className={`nav-link${(isActive('/dashboard/daily-log') || isBatchTab('history')) ? ' active' : ''}`}
          onClick={() => { setLogsOpen((o) => !o); if (!logsOpen) navTo('/dashboard/daily-log'); }}
        >
          <IconClipboard />
          <span>{t('nav.logs')}</span>
          <svg className="ml-auto transition-transform duration-200" style={{ transform: logsOpen ? 'rotate(90deg)' : 'rotate(0deg)' }} width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="m9 6 6 6-6 6"/></svg>
        </a>
        {logsOpen && (
          <div className="nav-sub">
            <a className={`nav-link${isActive('/dashboard/daily-log') ? ' active' : ''}`} onClick={() => navTo('/dashboard/daily-log')}>{t('nav.dailyUnitLog')}</a>
            <a className={`nav-link${isBatchTab('history') ? ' active' : ''}`} onClick={() => navTo('/dashboard/batch-entry?tab=history')}>{t('nav.readingHistory')}</a>
          </div>
        )}
      </nav>
      ) : (
      <nav className="flex flex-col gap-1">

        {/* Batch Sheet — production tracking */}
        {showBatches && (
          <a
            className={`nav-link${isActive('/dashboard/batches') ? ' active' : ''}`}
            onClick={() => navTo('/dashboard/batches')}
          >
            <IconFlask />
            <span>{t('nav.batchSheet')}</span>
            <span className="pill-count">1</span>
          </a>
        )}

        {/* Night Manager board */}
        {showNightMgr && (
          <a
            className={`nav-link${isActive('/dashboard/night-manager') ? ' active' : ''}`}
            onClick={() => navTo('/dashboard/night-manager')}
          >
            <IconMoon />
            <span>{t('nav.nightManager')}</span>
            <span className="pill-count" style={{ background: '#DBEAFE', color: '#2563EB' }}>new</span>
          </a>
        )}

        {/* CPM Stock — physical inventory (operational, not financial) */}
        {showStock && (
          <a
            className={`nav-link${isActive('/dashboard/stock') ? ' active' : ''}`}
            onClick={() => navTo('/dashboard/stock')}
          >
            <IconStock />
            <span>{t('nav.cpmStock')}</span>
          </a>
        )}

        {/* Warehouse Console — embedded entry view for Warehouse Manager role */}
        {showWarehouseEntry && (
          <a
            className={`nav-link${isActive('/dashboard/warehouse-entry') ? ' active' : ''}`}
            onClick={() => navTo('/dashboard/warehouse-entry')}
          >
            <IconWarehouse />
            <span>{t('nav.warehouseConsole')}</span>
            <span className="pill-count" style={{ background: '#F0FDF4', color: '#16A34A' }}>entry</span>
          </a>
        )}

        {/* Night Check-in — embedded view for Night Manager role */}
        {showNightEntry && (
          <a
            className={`nav-link${isActive('/dashboard/night-entry') ? ' active' : ''}`}
            onClick={() => navTo('/dashboard/night-entry')}
          >
            <IconMoon />
            <span>{t('nav.nightCheckin')}</span>
            <span className="pill-count" style={{ background: '#EEF2FF', color: '#4F46E5' }}>entry</span>
          </a>
        )}

        {/* Batch Entry — embedded view for Factory Operator role */}
        {showBatchEntry && (
          <a
            className={`nav-link${isActive('/dashboard/batch-entry') ? ' active' : ''}`}
            onClick={() => navTo('/dashboard/batch-entry')}
          >
            <IconBatch />
            <span>{t('nav.logReading')}</span>
            <span className="pill-count" style={{ background: '#FAF5FF', color: '#7C3AED' }}>entry</span>
          </a>
        )}

        {/* Daily Unit Log — OCR upload for hourly monitoring sheets */}
        {showDailyLog && (
          <a
            className={`nav-link${isActive('/dashboard/daily-log') ? ' active' : ''}`}
            onClick={() => navTo('/dashboard/daily-log')}
          >
            <IconClipboard />
            <span>{t('nav.dailyUnitLog')}</span>
            <span className="pill-count" style={{ background: '#FFFBEB', color: '#D97706' }}>OCR</span>
          </a>
        )}
      </nav>
      )}

      {/* ── FINANCE ───────────────────────────────────────────────────────── */}
      {showFinance && <SectionHeader label={t('section.finance')} />}
      <nav className="flex flex-col gap-1">

        {/* Sales contracts & dispatch */}
        {showSales && (
          <a
            className={`nav-link${isActive('/dashboard/sales') ? ' active' : ''}`}
            onClick={() => navTo('/dashboard/sales')}
          >
            <IconCart />
            <span>{t('nav.sales')}</span>
            <span className="pill-count">2</span>
          </a>
        )}

        {/* Customer history & outstanding */}
        {showCustomers && (
          <a
            className={`nav-link${isActive('/dashboard/customers') ? ' active' : ''}`}
            onClick={() => navTo('/dashboard/customers')}
          >
            <IconUsers />
            <span>{t('nav.customerHistory')}</span>
            <span className="pill-count" style={{ background: '#DBEAFE', color: '#2563EB' }}>new</span>
          </a>
        )}
      </nav>

      {/* ── REFERENCE ─────────────────────────────────────────────────────── */}
      {showReference && <SectionHeader label={t('section.reference')} />}
      <nav className="flex flex-col gap-1">
        {showOilRatio && (
          <a
            className={`nav-link${isActive('/dashboard/oil-ratio') ? ' active' : ''}`}
            onClick={() => navTo('/dashboard/oil-ratio')}
          >
            <IconFile />
            <span>{t('nav.oilRatioTable')}</span>
            <span className="pill-count" style={{ background: '#FEF3C7', color: '#B45309' }}>brain</span>
          </a>
        )}
        {showAudit && (
          <a
            className={`nav-link${isActive('/dashboard/audit') ? ' active' : ''}`}
            onClick={() => navTo('/dashboard/audit')}
          >
            <IconAudit />
            <span>{t('nav.auditLog')}</span>
          </a>
        )}
      </nav>

      {/* ── MONITORING ────────────────────────────────────────────────────── */}
      {(showIntelligence || showAnomalies) && <SectionHeader label={t('section.monitoring')} />}
      {(showIntelligence || showAnomalies) && (
        <nav className="flex flex-col gap-1">

          {/* Intelligence accordion — analytical pages, collapsed like Purchase */}
          {showIntelligence && (
            <>
              <a
                className={`nav-link${MONITORING_PATHS.some((p) => location.pathname.startsWith(p)) ? ' active' : ''}`}
                onClick={() => {
                  setMonitoringOpen((o) => !o);
                  if (!monitoringOpen) navTo(INTELLIGENCE_TABS[0].path);
                }}
              >
                <IconActivity />
                <span>{t('nav.intelligence')}</span>
                <svg
                  className="ml-auto transition-transform duration-200"
                  style={{ transform: monitoringOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}
                  width="11" height="11" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2.4"
                >
                  <path d="m9 6 6 6-6 6"/>
                </svg>
              </a>

              {monitoringOpen && (
                <div className="nav-sub">
                  {INTELLIGENCE_TABS.map((it) => (
                    <a
                      key={it.path}
                      className={`nav-link${isActive(it.path) ? ' active' : ''}`}
                      onClick={() => navTo(it.path)}
                    >
                      {t(it.key)}
                    </a>
                  ))}
                </div>
              )}
            </>
          )}

          {/* Anomaly Detection — peer of the accordion, never inside it */}
          {showAnomalies && (
            <a
              className={`nav-link${isActive('/dashboard/anomalies') ? ' active' : ''}`}
              onClick={() => navTo('/dashboard/anomalies')}
            >
              <IconAlert />
              <span>{t('nav.anomalyDetection')}</span>
              {criticalCount > 0 && (
                <span className="pill-count" style={{ background: '#FEF2F2', color: '#DC2626' }}>
                  {criticalCount > 9 ? '9+' : criticalCount}
                </span>
              )}
            </a>
          )}
        </nav>
      )}

      {/* ── ADMIN ─────────────────────────────────────────────────────────── */}
      {(showAdmin || showBlacklist) && <SectionHeader label={t('section.admin')} />}
      <nav className="flex flex-col gap-1">
        {showAdmin && (
          <a
            className={`nav-link${isActive('/dashboard/users') ? ' active' : ''}`}
            onClick={() => navTo('/dashboard/users')}
          >
            <IconUserPlus />
            <span>{t('nav.userManagement')}</span>
            <span className="pill-count" style={{ background: '#FEF3C7', color: '#B45309' }}>admin</span>
          </a>
        )}
        {showBlacklist && (
          <a
            className={`nav-link${isActive('/dashboard/blacklist') ? ' active' : ''}`}
            onClick={() => navTo('/dashboard/blacklist')}
          >
            <IconBan />
            <span>{t('nav.blacklist')}</span>
            <span className="pill-count" style={{ background: '#FEF2F2', color: '#DC2626' }}>restrict</span>
          </a>
        )}
      </nav>

      {/* ── User card — shows active profile, not real auth user ──────────── */}
      <div className="mt-6 p-3 rounded-2xl bg-slate-50">
        <div className="flex items-center gap-2.5">
          <div
            className={[
              'w-9 h-9 rounded-full flex-shrink-0',
              'bg-gradient-to-br',
              activeProfile.avatarFrom,
              activeProfile.avatarTo,
              'flex items-center justify-center',
              'text-white font-bold text-xs',
            ].join(' ')}
          >
            {activeProfile.initials}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-semibold leading-tight truncate">
              {activeProfile.name}
            </div>
            <div className="text-[11px] text-slate-500">{activeProfile.roleLabel}</div>
            {activeProfile.plant && (
              <div className="text-[10px] text-slate-400">📍 {activeProfile.plant}</div>
            )}
            {activeProfile.accessNote && (
              <div className="text-[9px] text-slate-400 truncate mt-0.5" title={activeProfile.accessNote}>
                {activeProfile.accessNote}
              </div>
            )}
          </div>
        </div>
        {/* Sign out lives in the top-right avatar menu (ProfileSwitcher), not here. */}
      </div>
    </aside>
  );
}
