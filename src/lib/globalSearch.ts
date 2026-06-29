/**
 * Global quick-search (Cmd+K palette) data layer.
 *
 * Searches across the app's records — tickets, people, customers, store
 * requisitions, assets, blacklist, batches, purchase contracts — by matching
 * the query against each table's key text columns (case-insensitive `ilike`).
 *
 * Access-aware: an entity is only searched if the active profile can reach its
 * page (so a technician never sees admin-only records). Every table query is
 * wrapped so a missing table / RLS denial yields no results instead of throwing.
 */
import { supabase } from './supabase';

export type SearchType =
  | 'ticket' | 'user' | 'customer' | 'storereq' | 'asset' | 'blacklist' | 'batch' | 'po';

export interface SearchResult {
  id: string;
  type: SearchType;
  title: string;
  subtitle?: string;
  /** Where selecting the result navigates. */
  route: string;
}

interface EntityConfig {
  type: SearchType;
  table: string;
  select: string;
  /** Columns matched with ilike. */
  columns: string[];
  /** Page route — also the access gate. */
  route: string;
  /** i18n key for this group's heading. */
  groupKey: string;
  map: (row: Record<string, unknown>) => Omit<SearchResult, 'type'>;
}

const str = (v: unknown): string => (v == null ? '' : String(v));
const join = (parts: unknown[]): string | undefined => {
  const s = parts.map(str).filter(Boolean).join(' · ');
  return s || undefined;
};
const clip = (s: string, n = 90): string => (s.length > n ? s.slice(0, n - 1) + '…' : s);

const ENTITIES: EntityConfig[] = [
  {
    type: 'ticket',
    table: 'maintenance_tickets',
    select: 'id, title, equipment, description, raised_by, assigned_to, status',
    columns: ['title', 'equipment', 'description', 'raised_by', 'assigned_to'],
    route: '/dashboard/purchase/maint',
    groupKey: 'palette.groupTickets',
    map: (r) => ({
      id: str(r.id),
      title: str(r.equipment) || str(r.title) || 'Ticket',
      subtitle: clip(join([r.status, r.description]) ?? ''),
      // Maintenance tickets have a real record-level deep-link.
      route: `/dashboard/purchase/maint?ticket=${str(r.id)}`,
    }),
  },
  {
    type: 'user',
    table: 'user_accounts',
    select: 'id, name, role_label, plant_name, email, mobile, designation',
    columns: ['name', 'email', 'mobile', 'whatsapp', 'role_label', 'plant_name', 'designation'],
    route: '/dashboard/users',
    groupKey: 'palette.groupPeople',
    map: (r) => ({
      id: str(r.id),
      title: str(r.name),
      subtitle: join([r.role_label, r.plant_name, r.email]),
      route: '/dashboard/users',
    }),
  },
  {
    type: 'customer',
    table: 'customers',
    select: 'id, name, place',
    columns: ['name', 'place'],
    route: '/dashboard/customers',
    groupKey: 'palette.groupCustomers',
    map: (r) => ({ id: str(r.id), title: str(r.name), subtitle: join([r.place]), route: '/dashboard/customers' }),
  },
  {
    type: 'storereq',
    table: 'store_requisitions',
    select: 'id, item, raised_by, status',
    columns: ['item', 'raised_by', 'approved_by', 'remarks'],
    route: '/dashboard/purchase/storereq',
    groupKey: 'palette.groupStoreReq',
    map: (r) => ({ id: str(r.id), title: str(r.item) || 'Requisition', subtitle: join([r.status, r.raised_by]), route: '/dashboard/purchase/storereq' }),
  },
  {
    type: 'asset',
    table: 'fixed_assets',
    select: 'id, name, model, identification_mark, account_head',
    columns: ['name', 'identification_mark', 'model', 'capacity', 'invoice_no', 'account_head'],
    route: '/dashboard/purchase/far',
    groupKey: 'palette.groupAssets',
    map: (r) => ({ id: str(r.id), title: str(r.name) || 'Asset', subtitle: join([r.model, r.identification_mark, r.account_head]), route: '/dashboard/purchase/far' }),
  },
  {
    type: 'blacklist',
    table: 'blacklist',
    select: 'id, name, type, severity, reason',
    columns: ['name', 'identifier', 'reason', 'notes', 'reference_no', 'added_by'],
    route: '/dashboard/blacklist',
    groupKey: 'palette.groupBlacklist',
    map: (r) => ({ id: str(r.id), title: str(r.name), subtitle: join([r.type, r.severity, r.reason]), route: '/dashboard/blacklist' }),
  },
  {
    type: 'batch',
    table: 'active_batches',
    select: 'id, batch_no, recipe, status',
    columns: ['batch_no', 'recipe'],
    route: '/dashboard/batches',
    groupKey: 'palette.groupBatches',
    map: (r) => ({ id: str(r.id), title: str(r.batch_no) ? `#${str(r.batch_no)}` : 'Batch', subtitle: join([r.recipe, r.status]), route: '/dashboard/batches' }),
  },
  {
    type: 'po',
    table: 'oil_contracts',
    select: 'id, oil_type, company, status',
    columns: ['oil_type', 'company', 'paraffin_type', 'port'],
    route: '/dashboard/purchase/purchase',
    groupKey: 'palette.groupPurchase',
    map: (r) => ({ id: str(r.id), title: join([r.oil_type, r.company]) ?? 'Purchase order', subtitle: join([r.status]), route: '/dashboard/purchase/purchase' }),
  },
];

/** i18n group key per result type (for headings in the palette). */
export const GROUP_KEY: Record<SearchType, string> = Object.fromEntries(
  ENTITIES.map((e) => [e.type, e.groupKey]),
) as Record<SearchType, string>;

/** Strip characters that would break the PostgREST `or(...)` filter syntax. */
function sanitize(q: string): string {
  return q.replace(/[%,()*\\]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Search every entity the active profile can access. Each entity is capped to a
 * handful of hits; the palette groups the flat list by `type`.
 */
export async function searchEntities(
  query: string,
  canAccess: (route: string) => boolean,
): Promise<SearchResult[]> {
  const q = sanitize(query);
  if (q.length < 2) return [];

  const targets = ENTITIES.filter((e) => canAccess(e.route));
  const orFilter = (cols: string[]) => cols.map((c) => `${c}.ilike.%${q}%`).join(',');

  const settled = await Promise.all(
    targets.map(async (e) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const qb: any = (supabase as any).from(e.table);
        const { data, error } = await qb.select(e.select).or(orFilter(e.columns)).limit(6);
        if (error || !Array.isArray(data)) return [] as SearchResult[];
        return (data as Record<string, unknown>[]).map((row) => ({ type: e.type, ...e.map(row) }) as SearchResult);
      } catch {
        return [] as SearchResult[];
      }
    }),
  );

  return settled.flat();
}
