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
      '/dashboard/anomalies',             // Anomaly detection (ops/vendor/equipment scope)
      '/dashboard/anomaly-center',        // Phase 2: Anomaly Operations Center
      '/dashboard/cost-intelligence',     // Phase 2: Cost & Margin Intelligence
      '/dashboard/benchmarking',          // Phase 2: Multi-Plant Benchmarking
      '/dashboard/predictive-qc',         // Phase 2: Live Predictive QC board
      '/dashboard/working-capital',       // Phase 2: Working Capital & Cash
      '/dashboard/blacklist',             // Blacklist registry (admin + unit head)
      // NOT /dashboard/sales            — sales team only
      // NOT /dashboard/customers        — accounts team only
    ],
    standaloneOnly: false,
    accessNote: 'No sales, customer or finance-only data',
  },

  // ── L2: Warehouse Dispatch — physical stock in/out ────────────────────────
  // Sees: CPM Stock levels, Store requisitions, Warehouse app
  // Hidden: Overview (has financial KPIs), Batches, Sales, everything else
  {
    id: 'warehouse_manager',
    name: 'Ramesh Yadav',
    role: 'L2',
    roleLabel: 'Warehouse Dispatch',
    roleDescription: 'Dispatch · shipping · inventory out',
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

  // ── L1: Technical Team — document digitisation + batch logging ────────────
  // Data entry and document digitisation via image uploads.
  // Can upload Sales, Purchase, and Batch Sheet images for OCR extraction.
  {
    id: 'factory_operator',
    name: 'Shyam Patel',
    role: 'L1',
    roleLabel: 'Technical Team',
    roleDescription: 'Data entry · OCR uploads · batch logging',
    initials: 'SP',
    avatarFrom: 'from-purple-400',
    avatarTo: 'to-purple-600',
    plant: 'Rehla',
    homeRoute: '/dashboard/batch-entry',       // Lands on the Batch dropdown (Log Reading)
    allowedDashboardRoutes: [
      // Batch dropdown — Log Reading / New Batch / Upload Batch Sheet / Reading
      // History all live on the batch logger page (switched via ?tab=).
      '/dashboard/batch-entry',
      // Operations dropdown
      '/dashboard/batches',                   // Batch Sheet board
      '/dashboard/stock',                     // CPM Stock
      // Logs dropdown
      '/dashboard/daily-log',                 // Daily Unit Log (OCR)
    ],
    standaloneOnly: false,
    accessNote: 'Batch logging, operations boards & daily logs · no sales/purchase/finance',
  },

  // ── L2: Store Manager (Maintenance) — spare parts store for maintenance ─────
  // Reviews store requests from technicians, checks availability, uploads docs.
  // Also handles handover of procured parts (invoice + photo) to technicians.
  {
    id: 'store_manager_maint',
    name: 'Suresh Kumar',
    role: 'L2',
    roleLabel: 'Store Manager · Maint',
    roleDescription: 'Spare parts store · availability check · handover docs',
    initials: 'SK',
    avatarFrom: 'from-lime-400',
    avatarTo: 'to-lime-600',
    plant: 'SHD',
    homeRoute: '/dashboard/purchase/maint',
    allowedDashboardRoutes: [
      '/dashboard/purchase/maint',
      '/dashboard/purchase/storereq',
    ],
    standaloneOnly: false,
    accessNote: 'Maintenance store actions only · no financial or production access',
  },

  // ── L2: Store Manager · Suntek Chlorides (Jharkhand / Rehla) ───────────────
  {
    id: 'store_manager_chlorides',
    name: 'Suresh Kumar',
    role: 'L2',
    roleLabel: 'Store Manager · Chlorides',
    roleDescription: 'Spare-parts store for the Suntek Chlorides unit',
    initials: 'SK',
    avatarFrom: 'from-lime-400',
    avatarTo: 'to-lime-600',
    plant: 'Suntek Chlorides',
    homeRoute: '/dashboard/purchase/maint',
    allowedDashboardRoutes: ['/dashboard/purchase/maint', '/dashboard/purchase/storereq'],
    standaloneOnly: false,
    accessNote: 'Suntek Chlorides store · maintenance only',
  },

  // ── L2: Store Manager · Suntek Plasticiser (Jharkhand / Rehla) ─────────────
  {
    id: 'store_manager_plasticiser',
    name: 'Ravi Verma',
    role: 'L2',
    roleLabel: 'Store Manager · Plasticiser',
    roleDescription: 'Spare-parts store for the Suntek Plasticiser unit',
    initials: 'RV',
    avatarFrom: 'from-teal-400',
    avatarTo: 'to-teal-600',
    plant: 'Suntek Plasticiser',
    homeRoute: '/dashboard/purchase/maint',
    allowedDashboardRoutes: ['/dashboard/purchase/maint', '/dashboard/purchase/storereq'],
    standaloneOnly: false,
    accessNote: 'Suntek Plasticiser store · maintenance only',
  },

  // ── L1: Technician — maintenance ticket management ────────────────────────
  // Sees own maintenance tickets only. Closes tickets with photo proof.
  // Cannot access financial, sales, or production data.
  {
    id: 'technician_shd',
    name: 'Anooj Kumar',
    role: 'L1',
    roleLabel: 'Technician · SHD',
    roleDescription: 'Maintenance tickets · repairs · photo proof upload',
    initials: 'AK',
    avatarFrom: 'from-cyan-400',
    avatarTo: 'to-cyan-600',
    plant: 'SHD',
    homeRoute: '/dashboard/purchase/maint',
    allowedDashboardRoutes: [
      '/dashboard/purchase/maint',
    ],
    standaloneOnly: false,
    accessNote: 'Maintenance tickets only · no financial or production access',
  },

  // ── L2: Purchase Manager — procurement bill + dispatch tracking ────────────
  // After the unit head approves external procurement and procures (BUSY ref),
  // the ticket comes here: the purchase manager uploads the supplier bill photo
  // and marks the part en route to the store.
  {
    id: 'purchase_manager',
    name: 'Anshul',
    role: 'L2',
    roleLabel: 'Purchase Manager',
    roleDescription: 'Procurement bills · dispatch tracking',
    initials: 'AN',
    avatarFrom: 'from-fuchsia-400',
    avatarTo: 'to-fuchsia-600',
    homeRoute: '/dashboard/purchase/maint',
    allowedDashboardRoutes: [
      '/dashboard/purchase/maint',
      '/dashboard/purchase/purchase',
    ],
    standaloneOnly: false,
    accessNote: 'Procurement bill upload + dispatch tracking · maintenance & POs',
  },

  // ── L2: Accountant (Delhi) — Delhi factory financial/operational data ─────
  // Can view and process financial/operational data for the Delhi factory only.
  // Purchase sheets are read-only for all accountants (anti-tampering rule).
  {
    id: 'accountant_delhi',
    name: 'Priya Sharma',
    role: 'L2',
    roleLabel: 'Accountant · Delhi',
    roleDescription: 'Delhi factory financial & operational data',
    initials: 'PS',
    avatarFrom: 'from-rose-400',
    avatarTo: 'to-rose-600',
    plant: 'Delhi',
    homeRoute: '/dashboard',
    allowedDashboardRoutes: [
      '/dashboard',                       // Overview (financial KPIs)
      '/dashboard/sales',                 // Sales contracts & dispatch
      '/dashboard/customers',             // Customer history
      '/dashboard/anomalies',             // Anomaly detection (financial/customer scope)
      '/dashboard/anomaly-center',        // Phase 2: Anomaly Operations Center
      '/dashboard/cost-intelligence',     // Phase 2: Cost & Margin Intelligence
      '/dashboard/benchmarking',          // Phase 2: Multi-Plant Benchmarking
      '/dashboard/predictive-qc',         // Phase 2: Live Predictive QC board
      '/dashboard/working-capital',       // Phase 2: Working Capital & Cash
      '/dashboard/purchase/purchase',     // Purchase orders (read-only data)
      '/dashboard/purchase/marine',       // Marine insurance fund
      '/dashboard/purchase/labour',       // Labour cost tracking
      '/dashboard/audit',                 // Audit trail
    ],
    standaloneOnly: false,
    accessNote: 'Delhi factory data only · purchase data is read-only',
  },

  // ── L2: Accountant (Other Factories) — all factories except Delhi ─────────
  // Can view data for all factories EXCLUDING the Delhi factory.
  {
    id: 'accountant_other',
    name: 'Deepak Verma',
    role: 'L2',
    roleLabel: 'Accountant · Other',
    roleDescription: 'All factories (excl. Delhi) financial data',
    initials: 'DV',
    avatarFrom: 'from-amber-400',
    avatarTo: 'to-amber-600',
    plant: 'Rehla · Jharsuguda',
    homeRoute: '/dashboard',
    allowedDashboardRoutes: [
      '/dashboard',                       // Overview (financial KPIs)
      '/dashboard/sales',                 // Sales contracts & dispatch
      '/dashboard/customers',             // Customer history
      '/dashboard/anomalies',             // Anomaly detection (financial/customer scope)
      '/dashboard/anomaly-center',        // Phase 2: Anomaly Operations Center
      '/dashboard/cost-intelligence',     // Phase 2: Cost & Margin Intelligence
      '/dashboard/benchmarking',          // Phase 2: Multi-Plant Benchmarking
      '/dashboard/predictive-qc',         // Phase 2: Live Predictive QC board
      '/dashboard/working-capital',       // Phase 2: Working Capital & Cash
      '/dashboard/purchase/purchase',     // Purchase orders (read-only data)
      '/dashboard/purchase/marine',       // Marine insurance fund
      '/dashboard/purchase/labour',       // Labour cost tracking
      '/dashboard/audit',                 // Audit trail
    ],
    standaloneOnly: false,
    accessNote: 'All factories except Delhi · purchase data is read-only',
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
