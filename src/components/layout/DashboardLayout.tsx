import React from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { RestrictedAccess } from './RestrictedAccess';
import { useAuth } from '../../hooks/useAuth';
import { useRoleContext } from '../../contexts/RoleContext';
import { profileCanAccess } from '../../lib/profiles';

const PAGE_TITLES: Record<string, string> = {
  '/dashboard': 'Operations dashboard',
  '/dashboard/sales': 'Sales · contracts & dispatch',
  '/dashboard/stock': 'CPM Stock · tanks, drums, items',
  '/dashboard/batches': 'Batch Sheet · production',
  '/dashboard/customers': 'Customer History',
  '/dashboard/night-manager': 'Night Manager · GPS + photos',
  '/dashboard/oil-ratio': 'Oil Ratio Table · the brain',
  '/dashboard/night-entry':     'Night Check-in',
  '/dashboard/batch-entry':     'Batch Logger',
  '/dashboard/warehouse-entry': 'Warehouse Console',
};

const BREADCRUMBS: Record<string, string> = {
  '/dashboard': 'Workspace · Overview',
  '/dashboard/sales': 'Workspace · Sales',
  '/dashboard/stock': 'Workspace · CPM Stock',
  '/dashboard/batches': 'Workspace · Batch Sheet',
  '/dashboard/customers': 'Workspace · Customer History',
  '/dashboard/night-manager': 'Workspace · Night Manager',
  '/dashboard/oil-ratio': 'Workspace · Oil Ratio Table',
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
  const { user, signOut } = useAuth();
  const { isViewingAs, activeProfile, switchProfile } = useRoleContext();
  const location = useLocation();
  const navigate = useNavigate();

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

          {/* Route guard: show content OR restricted page */}
          {canAccessRoute ? <Outlet /> : <RestrictedAccess />}
        </div>
      </main>
    </div>
  );
}
