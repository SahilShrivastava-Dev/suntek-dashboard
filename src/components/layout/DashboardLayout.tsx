import React, { useRef, useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate, Navigate } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { Footer } from './Footer';
import { RestrictedAccess } from './RestrictedAccess';
import { useAuth } from '../../hooks/useAuth';
import { useRoleContext } from '../../contexts/RoleContext';
import { profileCanAccess } from '../../lib/profiles';
import { useBlacklist } from '../../contexts/BlacklistContext';
import type { BlacklistEntry } from '../../contexts/BlacklistContext';
import { ErrorBoundary } from '../ErrorBoundary';
import { SearchPaletteProvider } from '../../contexts/SearchPaletteContext';

// ── Blacklisted overlay ───────────────────────────────────────────────────────

const SEV_COLORS: Record<string, string> = {
  critical: '#DC2626',
  high:     '#EA580C',
  medium:   '#D97706',
  low:      '#2563EB',
};

function BlacklistedOverlay({ entry, onBack }: { entry: BlacklistEntry; onBack: () => void }) {
  const sevColor = SEV_COLORS[entry.severity] || '#DC2626';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', textAlign: 'center', padding: '40px 20px' }}>
      <div style={{ width: 72, height: 72, borderRadius: '50%', background: '#FEF2F2', border: `2px solid ${sevColor}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 24, fontSize: 32 }}>
        🚫
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, color: '#0F172A', marginBottom: 8 }}>
        Account Restricted
      </div>
      <div style={{ fontSize: 13, color: '#475569', maxWidth: 420, lineHeight: 1.6, marginBottom: 20 }}>
        This account has been restricted by the administrator. All dashboard data is hidden until the restriction is lifted.
      </div>

      <div style={{ background: '#FEF2F2', border: `1px solid ${sevColor}30`, borderRadius: 14, padding: '16px 24px', maxWidth: 440, width: '100%', marginBottom: 20, textAlign: 'left' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Reason</div>
        <div style={{ fontSize: 13, color: '#334155', lineHeight: 1.6 }}>{entry.reason}</div>
        <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 10px', borderRadius: 20, background: '#FEF2F2', color: sevColor, border: `1px solid ${sevColor}40` }}>
            {entry.severity.toUpperCase()}
          </span>
          <span style={{ fontSize: 11, color: '#94A3B8' }}>Added by {entry.added_by}</span>
        </div>
      </div>

      <div style={{ fontSize: 12, color: '#94A3B8', marginBottom: 24 }}>
        Contact admin to resolve this restriction · <strong style={{ color: '#475569' }}>Sagar Nenwani</strong>
      </div>

      <button
        onClick={onBack}
        style={{ padding: '10px 24px', borderRadius: 20, background: '#F1F5F9', border: '1px solid #E2E8F0', fontSize: 13, fontWeight: 600, color: '#475569', cursor: 'pointer', fontFamily: 'inherit' }}
      >
        ← Back to Admin view
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

const PAGE_TITLES: Record<string, string> = {
  '/dashboard': 'Operations Dashboard',
  '/dashboard/todo': 'To-Do',
  '/dashboard/sales': 'Sales · contracts & dispatch',
  '/dashboard/stock': 'CP and Stock · tanks, drums, items',
  '/dashboard/batches': 'Batch Sheet · production',
  '/dashboard/customers': 'Customer History',
  '/dashboard/night-manager': 'Night Manager',
  '/dashboard/oil-ratio': 'Oil Ratio Table · the brain',
  '/dashboard/audit': 'Audit log · security logs',
  '/dashboard/anomalies': 'Anomaly Detection · live risk radar',
  '/dashboard/anomaly-center': 'Anomaly Operations Center',
  '/dashboard/cost-intelligence': 'Cost & Margin Intelligence',
  '/dashboard/benchmarking': 'Multi-Plant Benchmarking',
  '/dashboard/predictive-qc': 'Live Predictive QC Board',
  '/dashboard/working-capital': 'Working Capital & Cash',
  '/dashboard/owner': 'Owner Intelligence',
  '/dashboard/night-entry':     'Night Check-in',
  '/dashboard/batch-entry':     'Batch Logger',
  '/dashboard/warehouse-entry': 'Warehouse Console',
  '/dashboard/blacklist':       'Blacklist · restricted entities',
};

const BREADCRUMBS: Record<string, string> = {
  '/dashboard': 'Workspace · Overview',
  '/dashboard/todo': 'Workspace · To-Do',
  '/dashboard/sales': 'Operations · Sales',
  '/dashboard/stock': 'Operations · CP and Stock',
  '/dashboard/batches': 'Factory · Batch Sheet',
  '/dashboard/customers': 'Operations · Customer History',
  '/dashboard/night-manager': 'Factory · Night Manager',
  '/dashboard/oil-ratio': 'Reference · Oil Ratio',
  '/dashboard/audit': 'Reference · Audit Log',
  '/dashboard/anomalies': 'Monitoring · Anomaly Detection',
  '/dashboard/night-entry':     'Workspace · Night Check-in',
  '/dashboard/batch-entry':     'Workspace · Batch Logger',
  '/dashboard/warehouse-entry': 'Workspace · Warehouse Console',
};

/** Per-sub-page titles/breadcrumbs/subtitles for the Factory dropdown's Purchase routes. */
const FACTORY_SUBPAGES: Record<string, { title: string; breadcrumb: string; subtitle?: string }> = {
  '/dashboard/purchase/far':      { title: 'Asset',             breadcrumb: 'Factory · FAR · Asset',    subtitle: 'Fixed Asset Register — every factory asset with its financial record.' },
  '/dashboard/purchase/qr':       { title: 'QR Codes',          breadcrumb: 'Factory · FAR · QR Codes', subtitle: 'Generate and print QR codes for factory assets.' },
  '/dashboard/purchase/maint':    { title: 'Maintenance',       breadcrumb: 'Factory · Maintenance',    subtitle: 'Plan, track and complete machine maintenance.' },
  '/dashboard/purchase/activity': { title: 'Activity Log',      breadcrumb: 'Factory · Activity Log',   subtitle: 'Every purchase-linked event, in one stream.' },
  '/dashboard/purchase/storereq': { title: 'Store Requisition', breadcrumb: 'Factory · Store Requisition', subtitle: 'Request materials, track approvals, manage stock and scrap.' },
  '/dashboard/purchase/purchase': { title: 'Purchase Order',    breadcrumb: 'Factory · Purchase Order', subtitle: 'Raise and track purchase orders.' },
  '/dashboard/purchase/marine':   { title: 'Marine Insurance',  breadcrumb: 'Factory · Marine Insurance' },
  '/dashboard/purchase/labour':   { title: 'Labour',            breadcrumb: 'Factory · Labour' },
};

/** v2 subtitles for non-purchase pages (rendered under the TopBar title). */
const PAGE_SUBTITLES: Record<string, string> = {
  '/dashboard': "Today's work, business KPIs and approvals across all plants.",
  '/dashboard/todo': 'Everything pending your action — updates live as work moves on.',
  '/dashboard/night-manager': 'Manage night duty schedules and employee check-ins.',
};

/**
 * Normalize dynamic detail paths to their parent list route before the
 * exact-match profileCanAccess() check (and title lookups). Semantics are
 * unchanged: the QR detail used to be an in-page panel on the list route, so
 * list access has always implied detail access.
 */
function guardPath(p: string): string {
  if (p.startsWith('/dashboard/purchase/qr/')) return '/dashboard/purchase/qr';
  return p;
}

/** Purchase tab paths — used to check if a restricted profile has any purchase access */
const PURCHASE_TAB_PATHS = [
  '/dashboard/purchase/far',
  '/dashboard/purchase/maint',
  '/dashboard/purchase/activity',
  '/dashboard/purchase/storereq',
  '/dashboard/purchase/purchase',
  '/dashboard/purchase/marine',
  '/dashboard/purchase/labour',
];

export function DashboardLayout() {
  const { user, signOut, session, loading: authLoading } = useAuth();
  const { isViewingAs, activeProfile, switchProfile, authResolved, can } = useRoleContext();
  const { isPersonBlacklisted, notifyActivity, tableReady: blacklistReady } = useBlacklist();
  const location = useLocation();
  const navigate = useNavigate();
  // Mobile sidebar drawer (md+ shows the sidebar permanently).
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Close the drawer whenever the route changes.
  useEffect(() => { setSidebarOpen(false); }, [location.pathname]);
  // v2 collapsed rail (md+ only), persisted per device.
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('suntek.sidebarCollapsed') === '1'; } catch { return false; }
  });
  const toggleCollapsed = () => setCollapsed(c => {
    try { localStorage.setItem('suntek.sidebarCollapsed', c ? '0' : '1'); } catch { /* private mode */ }
    return !c;
  });

  // Detect if the currently previewed profile is blacklisted
  const blacklistEntry = blacklistReady ? isPersonBlacklisted(activeProfile.name) : null;
  // Severity policy: LOW = monitor only (no access block, admin just gets alerts);
  // MEDIUM / HIGH / CRITICAL = restrict dashboard access.
  const restrictsAccess = !!blacklistEntry && blacklistEntry.severity !== 'low';

  // Fire a one-time notification when admin switches to a blacklisted profile
  const notifiedRef = useRef<string | null>(null);
  useEffect(() => {
    if (blacklistEntry && notifiedRef.current !== blacklistEntry.id) {
      notifiedRef.current = blacklistEntry.id;
      notifyActivity(blacklistEntry, `Dashboard accessed via role preview as ${activeProfile.roleLabel}`);
    }
  }, [blacklistEntry?.id]);

  // Production auth gate: a real Supabase session is required to reach the
  // management dashboard. In development we leave it open so the role/profile
  // switcher ("view-as") demo works without standing up auth.
  //
  // IMPORTANT: this guard must run AFTER every hook above — returning early
  // before a hook call changes the hook count between renders and crashes React
  // (Minified React error #300). All hooks are unconditional; only the render
  // output below is gated.
  if (import.meta.env.PROD && !authLoading && !session) {
    // Preserve the intended destination (e.g. a deep-linked ticket) for post-login return.
    const to = `/login?redirect=${encodeURIComponent(location.pathname + location.search)}`;
    return <Navigate to={to} replace />;
  }

  // While the session / profile is still resolving, show a loader instead of the
  // locked "Access Restricted" fallback (which flashes — or sticks — otherwise).
  if (!authResolved || authLoading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
          <div className="w-11 h-11 rounded-2xl bg-[#F47651] text-white flex items-center justify-center font-extrabold text-lg shadow-sm">S°</div>
          <div className="animate-spin" style={{ width: 22, height: 22, border: '2.5px solid #E2E8F0', borderTopColor: '#F47651', borderRadius: '50%' }} />
        </div>
      </div>
    );
  }

  const path = location.pathname;
  // Dynamic detail paths (e.g. /purchase/qr/:key) resolve titles + access via
  // their parent list route.
  const lookupPath = guardPath(path);

  // ── Page titles & breadcrumbs ──────────────────────────────────────────────
  let title = PAGE_TITLES[lookupPath] ?? 'Operations dashboard';
  let breadcrumb = BREADCRUMBS[lookupPath] ?? 'Workspace · Overview';
  let subtitle: string | undefined = PAGE_SUBTITLES[lookupPath];

  if (path.startsWith('/dashboard/purchase')) {
    // The horizontal sub-tab strip is gone; show the specific Factory sub-page.
    // The Purchase Orders page is shared with Operations→Purchase; when reached
    // that way (?ctx=ops) show the Operations framing instead of Factory's.
    const viaOps = path === '/dashboard/purchase/purchase'
      && new URLSearchParams(location.search).get('ctx') === 'ops';
    if (viaOps) {
      title = 'Purchase';
      breadcrumb = 'Operations · Purchase';
      subtitle = undefined;
    } else {
      const sub = FACTORY_SUBPAGES[lookupPath] ?? FACTORY_SUBPAGES['/dashboard/purchase/far'];
      title = sub.title;
      breadcrumb = sub.breadcrumb;
      subtitle = sub.subtitle;
    }
  }

  // ── Route-level access guard ───────────────────────────────────────────────
  //
  // Standalone-only roles (night_manager, factory_operator) have no dashboard access.
  // For other roles, check allowedDashboardRoutes via profileCanAccess().
  //
  // Special case: /dashboard/purchase (the accordion root) itself isn't in any
  // profile's allowedDashboardRoutes — it immediately redirects to the first
  // sub-tab. We allow it through if the profile has ANY purchase sub-tab access.
  //
  const isPurchaseRoot = path === '/dashboard/purchase';
  const hasSomePurchaseAccess = PURCHASE_TAB_PATHS.some((p) =>
    profileCanAccess(activeProfile, p)
  );

  // User Management is reachable by anyone with a user/role-management capability
  // (e.g. a delegated unit head), not only via an explicit route grant.
  const isUserMgmt = path === '/dashboard/users';
  const canAccessRoute =
    !activeProfile.standaloneOnly &&
    (isPurchaseRoot ? hasSomePurchaseAccess
      : isUserMgmt ? (can('manage_users') || can('manage_roles') || profileCanAccess(activeProfile, lookupPath))
      : profileCanAccess(activeProfile, lookupPath));

  // Post-login landing: a locked user who hits the Overview ('/dashboard') they
  // can't see is sent straight to their own home section, instead of bouncing
  // off the Access Restricted screen. Scoped to the index so other restricted
  // navigation still shows the explanatory page.
  if (
    !canAccessRoute &&
    path === '/dashboard' &&
    activeProfile.homeRoute !== '/dashboard' &&
    profileCanAccess(activeProfile, activeProfile.homeRoute)
  ) {
    return <Navigate to={activeProfile.homeRoute} replace />;
  }

  return (
    <SearchPaletteProvider>
    <div className="app-shell" data-sidebar-collapsed={collapsed ? 'true' : undefined} style={{ minHeight: '100vh' }}>
      <Sidebar
        user={user}
        onSignOut={signOut}
        mobileOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        collapsed={collapsed}
        onToggleCollapse={toggleCollapsed}
      />

      {/* Mobile drawer backdrop */}
      {sidebarOpen && (
        <div
          className="md:hidden fixed inset-0 bg-slate-900/40 z-40"
          onClick={() => setSidebarOpen(false)}
          aria-hidden
        />
      )}

      <main className="min-h-screen p-4 md:p-7 ml-0 md:ml-[var(--sidebar-width,260px)] transition-[margin] duration-200">
        <div className="max-w-[1500px] mx-auto">
          <TopBar title={title} breadcrumb={breadcrumb} subtitle={subtitle} onMenu={() => setSidebarOpen(true)} />

          {/* "Viewing as" banner — appears when not in Admin mode */}
          {isViewingAs && (
            <div className="flex items-center justify-between gap-3 px-4 py-2.5 mb-5 bg-orange-50 border border-orange-200 rounded-2xl">
              <div className="flex items-center gap-2.5">
                <div
                  className={[
                    'w-7 h-7 rounded-full flex-shrink-0',
                    'bg-gradient-to-br',
                    activeProfile.avatarFrom,
                    activeProfile.avatarTo,
                    'flex items-center justify-center',
                    'text-white font-bold text-[10px]',
                  ].join(' ')}
                >
                  {activeProfile.initials}
                </div>
                <div className="text-[13px] leading-tight">
                  <span className="font-semibold text-orange-900">
                    Viewing as {activeProfile.roleLabel}
                  </span>
                  <span className="text-orange-600"> · {activeProfile.name}</span>
                  {activeProfile.plant && (
                    <span className="text-orange-400"> · {activeProfile.plant}</span>
                  )}
                </div>
              </div>
              <button
                className="text-[12px] font-bold px-3 py-1.5 rounded-full bg-orange-500 text-white hover:bg-orange-600 transition-colors whitespace-nowrap flex-shrink-0"
                onClick={() => {
                  switchProfile('admin');
                  navigate('/dashboard');
                }}
              >
                ← Back to Admin
              </button>
            </div>
          )}

          {/* Route guard: blacklist (severity ≥ medium) → access check → content */}
          {canAccessRoute
            ? restrictsAccess && blacklistEntry
              ? <BlacklistedOverlay entry={blacklistEntry} onBack={() => { switchProfile('admin'); navigate('/dashboard'); }} />
              : (
                // Per-page boundary keyed on path: a crash in one page shows a
                // localised fallback and resets when the user navigates away,
                // rather than blanking the whole shell.
                <ErrorBoundary key={path} label={title}>
                  <Outlet />
                </ErrorBoundary>
              )
            : <RestrictedAccess />
          }

          <Footer />
        </div>
      </main>
    </div>
    </SearchPaletteProvider>
  );
}
