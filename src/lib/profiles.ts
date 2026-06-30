/**
 * Mock profile definitions for role-based dashboard preview.
 *
 * RULES for allowedDashboardRoutes:
 *  - Use ['*'] for unrestricted (admin only)
 *  - List EXACT route strings — no broad prefixes like '/dashboard/purchase'
 *    because that would expose all sub-tabs unintentionally
 *  - Purchase sub-tabs must be listed individually: '/dashboard/purchase/far' etc.
 *  - profileCanAccess() matches exact OR child paths (startsWith + '/')
 *  - Omitting '/dashboard' means the Overview page is hidden for that role
 */

export interface MockProfile {
  id: string;
  name: string;
  /**
   * The underlying role-template id this profile derives its permissions from.
   * For built-in role archetypes this equals `id`. For DB-provisioned users
   * (whose `id` is a per-person `db_<uuid>`) this is the role they were created
   * under — so notifications addressed to either the person OR their role both
   * reach them. Unset on the static archetypes (treated as === id).
   */
  baseRoleId?: string;
  /**
   * The Supabase auth user id (auth.users.id) backing this directory entry, when
   * it's a provisioned login. Lets the logged-in session map itself exactly to
   * its `db_<uuid>` directory identity without relying on name matching.
   */
  authUserId?: string;
  /** When this person's account was provisioned (user_accounts.created_at). Used
   * as a notification floor so a new user doesn't inherit pre-account history.
   * Unset on the static archetypes (they see everything). */
  accountCreatedAt?: string;
  role: string;
  roleLabel: string;
  roleDescription: string;
  initials: string;
  /** Full Tailwind class e.g. 'from-orange-300' */
  avatarFrom: string;
  /** Full Tailwind class e.g. 'to-orange-500' */
  avatarTo: string;
  plant?: string;
  /** Where to land after switching to this profile */
  homeRoute: string;
  /** Exact dashboard routes this profile can access. ['*'] = all. */
  allowedDashboardRoutes: string[];
  /** True = no dashboard at all, uses a standalone app */
  standaloneOnly: boolean;
  accessNote?: string;
}

/**
 * A row from the `roles` table — the single source of truth for RBAC.
 * Mirrors Database['public']['Tables']['roles']['Row'].
 */
export interface RoleRow {
  id: string;            // text PK, slug ('admin', 'unit_head', …)
  label: string;
  level: string;         // 'L1' | 'L2' | 'L3' | 'L4'
  description: string | null;
  home_route: string;
  allowed_routes: string[]; // exact route strings; ['*'] = all
  standalone_only: boolean;
  is_admin: boolean;
  is_system: boolean;
  avatar_from: string | null;
  avatar_to: string | null;
  sort_order: number | null;
}

/** Derive 2-letter initials from a person's name. */
export function initialsFrom(name: string): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length >= 2) return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  return parts[0].slice(0, 2).toUpperCase();
}

/**
 * Map a `roles` table row → the MockProfile shape consumed throughout the app.
 * `overrides` (name, ids, plant, etc. for a provisioned user) are applied last.
 * Initials are derived from the final name.
 */
export function roleToProfile(role: RoleRow, overrides?: Partial<MockProfile>): MockProfile {
  const name = overrides?.name ?? '';
  const base: MockProfile = {
    id: role.id,
    name,
    role: role.level,
    roleLabel: role.label,
    roleDescription: role.description ?? '',
    initials: initialsFrom(name),
    avatarFrom: role.avatar_from ?? 'from-slate-300',
    avatarTo: role.avatar_to ?? 'to-slate-500',
    homeRoute: role.home_route,
    allowedDashboardRoutes: role.allowed_routes ?? [],
    standaloneOnly: role.standalone_only,
  };
  const merged = { ...base, ...overrides };
  // Always recompute initials from the resolved name (override may set name).
  merged.initials = initialsFrom(merged.name);
  return merged;
}

/**
 * SAFETY-NET fallback only — NOT seed data. Used solely so the owner is never
 * locked out of the dashboard if the `roles` table fails to load entirely. The
 * real role catalog lives in the DB; this grants full access as a last resort.
 */
export const ADMIN_FALLBACK: MockProfile = {
  id: 'admin',
  name: '',
  role: 'L4',
  roleLabel: 'Owner · Admin',
  roleDescription: 'Full access to all modules and data',
  initials: '',
  avatarFrom: 'from-orange-300',
  avatarTo: 'to-orange-500',
  homeRoute: '/dashboard',
  allowedDashboardRoutes: ['*'],
  standaloneOnly: false,
};

/**
 * Returns true if the given profile can access the given route.
 *
 * Matching rules:
 *  1. ['*'] in allowedDashboardRoutes → always true (admin)
 *  2. EXACT match only — '/dashboard' does NOT grant access to '/dashboard/batches'
 *
 * Why exact match: Prefix matching caused a critical bug where Unit Head (who has
 * '/dashboard' in their routes) was granted access to '/dashboard/night-entry' and
 * '/dashboard/batch-entry' because those paths start with '/dashboard/'.
 * Those are L1 operator entry terminals — Unit Head views boards, not entry forms.
 *
 * All allowed routes are listed explicitly, so prefix matching is not needed.
 */
export function profileCanAccess(profile: MockProfile, route: string): boolean {
  if (profile.allowedDashboardRoutes.includes('*')) return true;
  return profile.allowedDashboardRoutes.includes(route);
}
