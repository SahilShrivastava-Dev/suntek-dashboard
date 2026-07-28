/**
 * Shared-store resolution — the pure half of the factory/store model.
 *
 * The rule the whole design turns on:
 *   store  → WHERE the stock physically is
 *   plant  → WHO owns the asset and WHO pays
 *
 * At Rehla three factories resolve to one store; everywhere else a factory
 * resolves to its own. These helpers are what make that a single decision
 * instead of a condition repeated in every screen — and they are pure, so the
 * invariants can actually be tested rather than only reasoned about.
 */

export interface FactoryStoreLink { plant_id: string; store_id: string }

/** Row shape shared by everything that lives in a register. */
export interface RegisterRow {
  plant_id?: string | null;
  /** Authoritative once migration 59 has run. */
  store_id?: string | null;
}

/**
 * Which register a row belongs to.
 *
 * Falls back to the factory when `store_id` is absent, so a database that has
 * not yet had migration 59 applied still groups sensibly instead of collapsing
 * every row into one nameless bucket.
 *
 * CRITICAL: every consumer — filter chips, row grouping, the anomaly
 * reconciler — must use THIS. When the chips keyed on plant_id while the table
 * keyed on store_id, selecting any chip matched nothing and the register
 * rendered empty.
 */
export function registerIdOf(row: RegisterRow): string | null {
  return row.store_id ?? row.plant_id ?? null;
}

/** Build the factory → store lookup. First link wins; a factory has one store. */
export function buildStoreByPlant(links: FactoryStoreLink[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const l of links) if (!m.has(l.plant_id)) m.set(l.plant_id, l.store_id);
  return m;
}

/** The store a factory draws from, or null when nothing is mapped yet. */
export function storeIdForPlant(
  storeByPlant: Map<string, string>,
  plantId: string | null | undefined,
): string | null {
  return plantId ? storeByPlant.get(plantId) ?? null : null;
}

/** Factories served by a store — three at Rehla, one everywhere else. */
export function factoriesForStore(links: FactoryStoreLink[], storeId: string): string[] {
  return [...new Set(links.filter(l => l.store_id === storeId).map(l => l.plant_id))];
}

/** Stores serving more than one factory. Only these can diverge buyer from user. */
export function sharedStoreIds(links: FactoryStoreLink[]): Set<string> {
  const count = new Map<string, Set<string>>();
  for (const l of links) {
    const s = count.get(l.store_id) ?? new Set<string>();
    s.add(l.plant_id);
    count.set(l.store_id, s);
  }
  return new Set([...count.entries()].filter(([, p]) => p.size > 1).map(([s]) => s));
}

/**
 * Stock a technician can actually be promised.
 *
 * Units another approved request is already holding are NOT available. With a
 * private register per factory this could never bite; on one shared row, three
 * technicians would otherwise each be told the same last unit was theirs.
 */
export function freeQty(item: { on_hand: number; reserved_qty?: number | null }): number {
  return Math.max(0, Number(item.on_hand) - Number(item.reserved_qty ?? 0));
}

/**
 * Can this factory legitimately draw from this store?
 *
 * The guard that stops a shared store becoming a free-for-all: a factory may
 * only consume from a store it is actually mapped to, so nobody can charge
 * another location's factory for stock taken here.
 */
export function canDrawFrom(
  links: FactoryStoreLink[],
  plantId: string | null | undefined,
  storeId: string | null | undefined,
): boolean {
  if (!plantId || !storeId) return false;
  return links.some(l => l.plant_id === plantId && l.store_id === storeId);
}
