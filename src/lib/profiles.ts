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

export const MOCK_PROFILES: MockProfile[] = [
  // ── L4: Owner / Admin ──────────────────────────────────────────────────────
  {
    id: 'admin',
    name: 'Sagar Nenwani',
    role: 'L4',
    roleLabel: 'Owner · Admin',
    roleDescription: 'Full access to all modules and data',
    initials: 'SN',
    avatarFrom: 'from-orange-300',
    avatarTo: 'to-orange-500',
    homeRoute: '/dashboard',
    allowedDashboardRoutes: ['*'],
    standaloneOnly: false,
  },

  // ── L3: Unit Head — ops oversight + procurement approvals ─────────────────
  // Sees: operations, stock, procurement workflow
  // Hidden: Sales contracts, Customer financials, Marine Insurance, Labour costs
  {
    id: 'unit_head',
    name: 'Vijay Ji',
    role: 'L3',
    roleLabel: 'Unit Head',
    roleDescription: 'Ops oversight · procurement approvals',
    initials: 'VJ',
    avatarFrom: 'from-blue-400',
    avatarTo: 'to-blue-600',
    homeRoute: '/dashboard',
    allowedDashboardRoutes: [
      '/dashboard',                       // Overview (ops KPIs)
      '/dashboard/batches',               // Batch production status
      '/dashboard/stock',                 // CPM inventory levels
      '/dashboard/night-manager',         // Night ops GPS board
      '/dashboard/purchase/far',          // Fixed Asset Register
      '/dashboard/purchase/maint',        // Maintenance logs
      '/dashboard/purchase/activity',     // Plant activity
      '/dashboard/purchase/storereq',     // Store requisitions
      '/dashboard/purchase/purchase',     // Purchase orders
      // NOT /dashboard/purchase/marine  — financial insurance fund
      // NOT /dashboard/purchase/labour  — HR dept handles
      '/dashboard/oil-ratio',             // Reference table
      '/dashboard/audit',                 // Audit trail
      // NOT /dashboard/sales            — sales team only
      // NOT /dashboard/customers        — accounts team only
    ],
    standaloneOnly: false,
    accessNote: 'No sales, customer or finance-only data',
  },

  // ── L2: Warehouse Manager — physical stock in/out ─────────────────────────
  // Sees: CPM Stock levels, Store requisitions, Warehouse app
  // Hidden: Overview (has financial KPIs), Batches, Sales, everything else
  {
    id: 'warehouse_manager',
    name: 'Ramesh Yadav',
    role: 'L2',
    roleLabel: 'Warehouse Manager',
    roleDescription: 'Stock levels · drums in/out · store reqs',
    initials: 'RY',
    avatarFrom: 'from-teal-400',
    avatarTo: 'to-teal-600',
    plant: 'Rehla',
    homeRoute: '/dashboard/warehouse-entry', // Land on the embedded warehouse console
    allowedDashboardRoutes: [
      '/dashboard/stock',                   // CPM inventory (monitoring view)
      '/dashboard/purchase/storereq',       // Raise & track store requisitions
      '/dashboard/warehouse-entry',         // Embedded warehouse console (stock entry + raise req)
    ],
    standaloneOnly: false,
    accessNote: 'Stock levels and store requisitions only',
  },

  // ── L2: Labour Manager — worker cost tracking ─────────────────────────────
  // Sees: Labour cost page, Activity log only
  // Hidden: Everything with financial, production or sales data
  {
    id: 'labour_manager',
    name: 'Mohan Lal',
    role: 'L2',
    roleLabel: 'Labour Manager',
    roleDescription: 'Labour cost tracking · worker activity',
    initials: 'ML',
    avatarFrom: 'from-green-400',
    avatarTo: 'to-green-600',
    homeRoute: '/dashboard/purchase/labour',  // Land directly on labour page
    allowedDashboardRoutes: [
      '/dashboard/purchase/labour',           // Labour cost analysis
      '/dashboard/purchase/activity',         // Plant worker activity logs
      // Nothing else — no overview, no stock, no batches, no sales
    ],
    standaloneOnly: false,
    accessNote: 'Labour costs and activity log only',
  },

  // ── L1: Night Manager — check-in form embedded in dashboard ──────────────
  // Single-purpose: GPS photo check-in. Sidebar shows, only the check-in
  // form appears on the right. No access to any other dashboard section.
  {
    id: 'night_manager',
    name: 'Devraj Singh',
    role: 'L1',
    roleLabel: 'Night Manager',
    roleDescription: 'GPS check-in · shift photo upload',
    initials: 'DS',
    avatarFrom: 'from-indigo-400',
    avatarTo: 'to-indigo-600',
    plant: 'Rehla',
    homeRoute: '/dashboard/night-entry',       // Embedded in the dashboard layout
    allowedDashboardRoutes: [
      '/dashboard/night-entry',               // Only the check-in page
    ],
    standaloneOnly: false,
    accessNote: 'Check-in form only · no other dashboard access',
  },

  // ── L1: Factory Operator — batch logger embedded in dashboard ─────────────
  // Single-purpose: log batch readings. Sidebar shows, batch logger form
  // appears on the right. No access to any other dashboard section.
  {
    id: 'factory_operator',
    name: 'Shyam Patel',
    role: 'L1',
    roleLabel: 'Factory Operator',
    roleDescription: 'Batch logging · machine readings',
    initials: 'SP',
    avatarFrom: 'from-purple-400',
    avatarTo: 'to-purple-600',
    plant: 'Rehla',
    homeRoute: '/dashboard/batch-entry',       // Embedded in the dashboard layout
    allowedDashboardRoutes: [
      '/dashboard/batch-entry',               // Only the batch logger page
    ],
    standaloneOnly: false,
    accessNote: 'Batch logger only · no other dashboard access',
  },
];

export const DEFAULT_PROFILE = MOCK_PROFILES.find((p) => p.id === 'admin')!;

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
