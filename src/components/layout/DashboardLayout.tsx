import React, { useRef, useEffect } from 'react';
import { Outlet, useLocation, useNavigate, Navigate } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { RestrictedAccess } from './RestrictedAccess';
import { useAuth } from '../../hooks/useAuth';
import { useRoleContext } from '../../contexts/RoleContext';
import { profileCanAccess } from '../../lib/profiles';
import { useBlacklist } from '../../contexts/BlacklistContext';
import type { BlacklistEntry } from '../../contexts/BlacklistContext';
import { ErrorBoundary } from '../ErrorBoundary';

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
  '/dashboard': 'Operations dashboard',
  '/dashboard/sales': 'Sales · contracts & dispatch',
  '/dashboard/stock': 'CPM Stock · tanks, drums, items',
  '/dashboard/batches': 'Batch Sheet · production',
  '/dashboard/customers': 'Customer History',
  '/dashboard/night-manager': 'Night Manager · GPS + photos',
  '/dashboard/oil-ratio': 'Oil Ratio Table · the brain',
  '/dashboard/audit': 'Audit log · security logs',
  '/dashboard/anomalies': 'Anomaly Detection · live risk radar',
  '/dashboard/anomaly-center': 'Anomaly Operations Center',
  '/dashboard/cost-intelligence': 'Cost & Margin Intelligence',
  '/dashboard/night-entry':     'Night Check-in',
  '/dashboard/batch-entry':     'Batch Logger',
  '/dashboard/warehouse-entry': 'Warehouse Console',
  '/dashboard/blacklist':       'Blacklist · restricted entities',
};

const BREADCRUMBS: Record<string, string> = {
  '/dashboard': 'Workspace · Overview',
  '/dashboard/sales': 'Workspace · Sales',
  '/dashboard/stock': 'Workspace · CPM Stock',
  '/dashboard/batches': 'Workspace · Batch Sheet',
  '/dashboard/customers': 'Workspace · Customer History',
  '/dashboard/night-manager': 'Workspace · Night Manager',
  '/dashboard/oil-ratio': 'Reference · Oil Ratio',
  '/dashboard/audit': 'Security · Operations',
  '/dashboard/anomalies': 'Monitoring · Anomaly Detection',
  '/dashboard/night-entry':     'Operations · Night Check-in',
  '/dashboard/batch-entry':     'Operations · Batch Logger',
  '/dashboard/warehouse-entry': 'Operations · Warehouse Console',
};

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
  const { isViewingAs, activeProfile, switchProfile } = useRoleContext();

  // Production auth gate: a real Supabase session is required to reach the
  // management dashboard. In development we leave it open so the role/profile
  // switcher ("view-as") demo works without standing up auth.
  if (import.meta.env.PROD && !authLoading && !session) {
    return <Navigate to="/login" replace />;
  }
  const { isPersonBlacklisted, notifyActivity, tableReady: blacklistReady } = useBlacklist();
  const location = useLocation();
  const navigate = useNavigate();

  // Detect if the currently previewed profile is blacklisted
  const blacklistEntry = blacklistReady ? isPersonBlacklisted(activeProfile.name) : null;

  // Fire a one-time notification when admin switches to a blacklisted profile
  const notifiedRef = useRef<string | null>(null);
  useEffect(() => {
    if (blacklistEntry && notifiedRef.current !== blacklistEntry.id) {
      notifiedRef.current = blacklistEntry.id;
      notifyActivity(blacklistEntry, `Dashboard accessed via role preview as ${activeProfile.roleLabel}`);
    }
  }, [blacklistEntry?.id]);

  const path = location.pathname;

  // ── Page titles & breadcrumbs ──────────────────────────────────────────────
  let title = PAGE_TITLES[path] ?? 'Operations dashboard';
  let breadcrumb = BREADCRUMBS[path] ?? 'Workspace · Overview';

  if (path.startsWith('/dashboard/purchase')) {
    title = 'Purchase · FAR · Maintenance · Store Req · POs · Marine · Labour';
    breadcrumb = 'Workspace · Purchase';
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

  const canAccessRoute =
    !activeProfile.standaloneOnly &&
    (isPurchaseRoot ? hasSomePurchaseAccess : profileCanAccess(activeProfile, path));

  return (
    <div style={{ minHeight: '100vh' }}>
      <Sidebar user={user} onSignOut={signOut} />

      <main
        className="min-h-screen p-5 md:p-7"
        style={{ marginLeft: '260px' }}
      >
        <div className="max-w-[1500px] mx-auto">
          <TopBar title={title} breadcrumb={breadcrumb} />

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

          {/* Route guard: blacklist check → access check → content */}
          {canAccessRoute
            ? blacklistEntry
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
        </div>
      </main>
    </div>
  );
}
