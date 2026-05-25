import type { UserRole } from '../database.types';

/**
 * Role hierarchy — higher number = more access.
 * L1: Frontline Operators  (factory, warehouse, night manager)
 * L2: Unit Heads / Supervisors  (review & approval)
 * L3: Procurement Heads (Vijay Ji)  (purchase authority)
 * L4: Owner / Admin (Sagar)  (full access + Busy API data)
 */
export const ROLE_LEVEL: Record<UserRole, number> = {
  L1: 1,
  L2: 2,
  L3: 3,
  L4: 4,
};

/** Returns true if the user's role meets or exceeds the required level. */
export function hasAccess(userRole: UserRole, requiredRole: UserRole): boolean {
  return ROLE_LEVEL[userRole] >= ROLE_LEVEL[requiredRole];
}

/** Returns the home route for a given role. */
export function getHomeRoute(role: UserRole): string {
  switch (role) {
    case 'L4':
    case 'L3':
    case 'L2':
      return '/dashboard';
    case 'L1':
    default:
      return '/operator/select'; // L1 picks their app (batch, warehouse, night-manager)
  }
}

/** Tile colour by data source */
export type TileVariant = 'red' | 'green' | 'yellow';

export const TILE_META: Record<TileVariant, { label: string; badgeClass: string }> = {
  red:    { label: 'Busy API',      badgeClass: 'badge-api'    },
  green:  { label: 'Excel Import',  badgeClass: 'badge-excel'  },
  yellow: { label: 'Manual Entry',  badgeClass: 'badge-manual' },
};
