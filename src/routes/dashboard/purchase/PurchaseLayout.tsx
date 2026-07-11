import { Outlet } from 'react-router-dom';

/**
 * Purchase hub layout. Navigation now lives solely in the left sidebar (Factory
 * dropdown), so this wrapper no longer renders its own horizontal sub-tab strip —
 * that was a duplicate of the sidebar. It stays as the routed parent for the
 * /dashboard/purchase/* pages and simply renders the active sub-page.
 */
export function PurchaseLayout() {
  return <Outlet />;
}
