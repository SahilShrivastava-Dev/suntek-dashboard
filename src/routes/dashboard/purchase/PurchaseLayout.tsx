import React from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../../lib/supabase';

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
  const [counts, setCounts] = React.useState<Record<string, number>>({});

  // Fetch live row counts for each tab (count-only, no rows downloaded).
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const results = await Promise.all(
        SUBTABS.map(async (tab) => {
          const { count, error } = await supabase
            .from(tab.table)
            .select('*', { count: 'exact', head: true });
          return [tab.id, error ? 0 : (count ?? 0)] as const;
        })
      );
      if (!cancelled) setCounts(Object.fromEntries(results));
    })();
    return () => { cancelled = true; };
  }, []);

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
        {SUBTABS.map(tab => (
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
