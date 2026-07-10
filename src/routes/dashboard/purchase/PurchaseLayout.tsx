import React from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../../lib/supabase';
import { useRoleContext } from '../../../contexts/RoleContext';
import { profileCanAccess } from '../../../lib/profiles';

// Each subtab maps to the Supabase table that backs its page. The badge shows
// the live row count for that table (hidden when zero) — no hardcoded numbers.
// labelKey = i18n key for the tab label.
const SUBTABS = [
  { id: 'far',      labelKey: 'purchase.tabFar',            table: 'fixed_assets'      },
  { id: 'maint',    labelKey: 'purchase.tabMaint',          table: 'maintenance_tickets' },
  { id: 'activity', labelKey: 'purchase.tabActivity',       table: 'activity_logs'     },
  { id: 'storereq', labelKey: 'purchase.tabStoreReq',       table: 'store_requisitions' },
  { id: 'purchase', labelKey: 'purchase.tabPurchaseOrders', table: 'oil_contracts'     },
] as const;

export function PurchaseLayout() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const { activeProfile } = useRoleContext();
  const [counts, setCounts] = React.useState<Record<string, number>>({});

  // Only show sub-tabs the current role can actually open — mirrors the sidebar's
  // permission gating (Sidebar visiblePurchaseTabs). A technician sees just Maintenance,
  // not FAR/Activity/Store Req/POs that would otherwise route to "Access Restricted".
  const visibleTabs = React.useMemo(
    () => SUBTABS.filter(tab => profileCanAccess(activeProfile, `/dashboard/purchase/${tab.id}`)),
    [activeProfile],
  );

  // Fetch live row counts for each visible tab (count-only, no rows downloaded).
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const results = await Promise.all(
        visibleTabs.map(async (tab) => {
          const { count, error } = await supabase
            .from(tab.table)
            .select('*', { count: 'exact', head: true });
          return [tab.id, error ? 0 : (count ?? 0)] as const;
        })
      );
      if (!cancelled) setCounts(Object.fromEntries(results));
    })();
    return () => { cancelled = true; };
  }, [visibleTabs]);

  // Determine active subtab from URL
  const segments = location.pathname.split('/');
  const lastSeg = segments[segments.length - 1];
  const activeTab = SUBTABS.find(tab => tab.id === lastSeg)?.id ?? 'far';

  function goToTab(id: string) {
    navigate(`/dashboard/purchase/${id}`);
  }

  return (
    <>
      {/* Sub-tabs */}
      <div className="flex items-center gap-2 mb-5 overflow-x-auto scroll-x">
        {visibleTabs.map(tab => (
          <div
            key={tab.id}
            className={`subtab${activeTab === tab.id ? ' active' : ''}`}
            onClick={() => goToTab(tab.id)}
          >
            {t(tab.labelKey)}
            {counts[tab.id] > 0 && (
              <span className="count">{counts[tab.id]}</span>
            )}
          </div>
        ))}
      </div>

      {/* Active sub-page */}
      <Outlet />
    </>
  );
}
