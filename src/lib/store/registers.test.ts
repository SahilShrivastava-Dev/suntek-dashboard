import { describe, it, expect } from 'vitest';
import {
  registerIdOf, buildStoreByPlant, storeIdForPlant, factoriesForStore,
  sharedStoreIds, freeQty, canDrawFrom, type FactoryStoreLink,
} from './registers';

// The client's actual shape: three factories at Rehla on ONE store; Sikandrabad
// and Ganjam each on their own; and — migration 69 — the Drum Plant, which sits
// at the Rehla SITE but must be completely independent of the common store.
const SCPL_REHLA = 'p-scpl-rehla';
const SPPL_REHLA = 'p-sppl-rehla';
const SPPLK_REHLA = 'p-spplk-rehla';
const DRUM_REHLA = 'p-drum-rehla';
const GANJAM = 'p-scpl-ganjam';
const SIKANDRABAD = 'p-madan-sikandrabad';

const REHLA_COMMON = 's-rehla-common';
const DRUM_STORE = 's-drum-rehla';
const GANJAM_STORE = 's-ganjam';
const SIKANDRABAD_STORE = 's-sikandrabad';

const LINKS: FactoryStoreLink[] = [
  { plant_id: SCPL_REHLA, store_id: REHLA_COMMON },
  { plant_id: SPPL_REHLA, store_id: REHLA_COMMON },
  { plant_id: SPPLK_REHLA, store_id: REHLA_COMMON },
  // Same location, DIFFERENT store. One row, and it is the whole feature.
  { plant_id: DRUM_REHLA, store_id: DRUM_STORE },
  { plant_id: GANJAM, store_id: GANJAM_STORE },
  { plant_id: SIKANDRABAD, store_id: SIKANDRABAD_STORE },
];

describe('Rehla — one store, three factories', () => {
  it('resolves all three Rehla factories to the SAME store', () => {
    const m = buildStoreByPlant(LINKS);
    expect(storeIdForPlant(m, SCPL_REHLA)).toBe(REHLA_COMMON);
    expect(storeIdForPlant(m, SPPL_REHLA)).toBe(REHLA_COMMON);
    expect(storeIdForPlant(m, SPPLK_REHLA)).toBe(REHLA_COMMON);
  });

  it('reports the Rehla store as serving exactly three factories', () => {
    expect(factoriesForStore(LINKS, REHLA_COMMON).sort())
      .toEqual([SCPL_REHLA, SPPLK_REHLA, SPPL_REHLA].sort());
  });

  it('flags only the Rehla store as shared', () => {
    const shared = sharedStoreIds(LINKS);
    expect(shared.has(REHLA_COMMON)).toBe(true);
    expect(shared.has(GANJAM_STORE)).toBe(false);
    expect(shared.has(SIKANDRABAD_STORE)).toBe(false);
  });

  it('lets any Rehla factory draw from the common store', () => {
    for (const p of [SCPL_REHLA, SPPL_REHLA, SPPLK_REHLA]) {
      expect(canDrawFrom(LINKS, p, REHLA_COMMON)).toBe(true);
    }
  });

  it('refuses a Rehla factory drawing from another location’s store', () => {
    expect(canDrawFrom(LINKS, SPPLK_REHLA, GANJAM_STORE)).toBe(false);
    expect(canDrawFrom(LINKS, SPPLK_REHLA, SIKANDRABAD_STORE)).toBe(false);
  });
});

// ── Migration 69 ────────────────────────────────────────────────────────────
// The Drum Plant is the hardest case for the store/factory split: it is at the
// SAME site as the three factories that share the Rehla common store, so nothing
// about geography separates them. Only the absence of a factory_store_access row
// does — which makes these assertions the ones that would actually catch a
// regression where someone "helpfully" mapped it to the common store.
describe('Drum Plant — independent, at a shared site', () => {
  it('resolves to its OWN store, not the Rehla common store', () => {
    const m = buildStoreByPlant(LINKS);
    expect(storeIdForPlant(m, DRUM_REHLA)).toBe(DRUM_STORE);
    expect(storeIdForPlant(m, DRUM_REHLA)).not.toBe(REHLA_COMMON);
  });

  it('leaves the common store serving exactly the three original factories', () => {
    expect(factoriesForStore(LINKS, REHLA_COMMON).sort())
      .toEqual([SCPL_REHLA, SPPLK_REHLA, SPPL_REHLA].sort());
    expect(factoriesForStore(LINKS, REHLA_COMMON)).not.toContain(DRUM_REHLA);
  });

  it('serves only itself from its own store', () => {
    expect(factoriesForStore(LINKS, DRUM_STORE)).toEqual([DRUM_REHLA]);
  });

  it('is not a shared store — so buyer and user can never diverge there', () => {
    const shared = sharedStoreIds(LINKS);
    expect(shared.has(DRUM_STORE)).toBe(false);
    // …and adding it did not make the common store stop being shared.
    expect(shared.has(REHLA_COMMON)).toBe(true);
  });

  it('cannot draw from the Rehla common store', () => {
    expect(canDrawFrom(LINKS, DRUM_REHLA, REHLA_COMMON)).toBe(false);
  });

  it('cannot have its store drawn on by any other Rehla factory', () => {
    for (const p of [SCPL_REHLA, SPPL_REHLA, SPPLK_REHLA]) {
      expect(canDrawFrom(LINKS, p, DRUM_STORE)).toBe(false);
    }
  });

  it('can draw from its own store', () => {
    expect(canDrawFrom(LINKS, DRUM_REHLA, DRUM_STORE)).toBe(true);
  });

  it('keeps its register distinct even for an identically named item', () => {
    // Same item name in both stores is legitimate — they are separate
    // registers. What must never happen is the two collapsing to one key.
    expect(registerIdOf({ store_id: DRUM_STORE, plant_id: DRUM_REHLA }))
      .not.toBe(registerIdOf({ store_id: REHLA_COMMON, plant_id: SCPL_REHLA }));
  });
});

describe('Sikandrabad + Ganjam — regression: single-store sites unchanged', () => {
  it('each resolves to its OWN store, not a shared one', () => {
    const m = buildStoreByPlant(LINKS);
    expect(storeIdForPlant(m, GANJAM)).toBe(GANJAM_STORE);
    expect(storeIdForPlant(m, SIKANDRABAD)).toBe(SIKANDRABAD_STORE);
    expect(storeIdForPlant(m, GANJAM)).not.toBe(storeIdForPlant(m, SIKANDRABAD));
  });

  it('each store serves exactly one factory', () => {
    expect(factoriesForStore(LINKS, GANJAM_STORE)).toEqual([GANJAM]);
    expect(factoriesForStore(LINKS, SIKANDRABAD_STORE)).toEqual([SIKANDRABAD]);
  });

  it('cannot draw from each other, nor from Rehla', () => {
    expect(canDrawFrom(LINKS, GANJAM, SIKANDRABAD_STORE)).toBe(false);
    expect(canDrawFrom(LINKS, SIKANDRABAD, GANJAM_STORE)).toBe(false);
    expect(canDrawFrom(LINKS, GANJAM, REHLA_COMMON)).toBe(false);
  });

  it('behaves identically to the pre-store world: factory in, one store out', () => {
    const m = buildStoreByPlant(LINKS);
    for (const p of [GANJAM, SIKANDRABAD]) {
      expect(factoriesForStore(LINKS, storeIdForPlant(m, p)!)).toEqual([p]);
    }
  });
});

describe('registerIdOf — chips and rows must agree', () => {
  // The bug this guards: chips keyed on plant_id while the table keyed on
  // store_id, so every chip selected nothing and the register looked empty.
  it('prefers store_id when present', () => {
    expect(registerIdOf({ plant_id: SPPL_REHLA, store_id: REHLA_COMMON })).toBe(REHLA_COMMON);
  });

  it('collapses all three Rehla factories onto one register key', () => {
    const rows = [
      { plant_id: SCPL_REHLA, store_id: REHLA_COMMON },
      { plant_id: SPPL_REHLA, store_id: REHLA_COMMON },
      { plant_id: SPPLK_REHLA, store_id: REHLA_COMMON },
    ];
    expect(new Set(rows.map(registerIdOf)).size).toBe(1);
  });

  it('falls back to plant_id before migration 59 (no store column yet)', () => {
    expect(registerIdOf({ plant_id: GANJAM })).toBe(GANJAM);
    expect(registerIdOf({ plant_id: GANJAM, store_id: null })).toBe(GANJAM);
  });

  it('returns null when a row belongs to nothing', () => {
    expect(registerIdOf({})).toBeNull();
  });
});

describe('freeQty — a shared row cannot be promised twice', () => {
  it('subtracts what other approved requests already hold', () => {
    expect(freeQty({ on_hand: 10, reserved_qty: 4 })).toBe(6);
  });

  it('treats a fully reserved row as out of stock', () => {
    expect(freeQty({ on_hand: 3, reserved_qty: 3 })).toBe(0);
  });

  it('never reports negative availability', () => {
    expect(freeQty({ on_hand: 2, reserved_qty: 5 })).toBe(0);
  });

  it('equals on_hand when nothing is reserved', () => {
    expect(freeQty({ on_hand: 7 })).toBe(7);
    expect(freeQty({ on_hand: 7, reserved_qty: null })).toBe(7);
  });

  it('stops the last unit being promised to three factories', () => {
    const item = { on_hand: 1, reserved_qty: 0 };
    expect(freeQty(item)).toBe(1);              // SCPL reserves it
    const afterScpl = { on_hand: 1, reserved_qty: 1 };
    expect(freeQty(afterScpl)).toBe(0);          // SPPL sees none
    expect(freeQty(afterScpl)).toBe(0);          // SPPL(K) sees none
  });
});

describe('canDrawFrom — cost cannot be pinned on an unrelated factory', () => {
  it('rejects an unmapped pairing', () => {
    expect(canDrawFrom(LINKS, 'p-unknown', REHLA_COMMON)).toBe(false);
  });

  it('rejects missing inputs rather than defaulting to allow', () => {
    expect(canDrawFrom(LINKS, null, REHLA_COMMON)).toBe(false);
    expect(canDrawFrom(LINKS, SCPL_REHLA, null)).toBe(false);
    expect(canDrawFrom(LINKS, undefined, undefined)).toBe(false);
  });
});

describe('buildStoreByPlant', () => {
  it('is empty before any mapping exists', () => {
    const m = buildStoreByPlant([]);
    expect(storeIdForPlant(m, SCPL_REHLA)).toBeNull();
  });

  it('keeps one store per factory even if links repeat', () => {
    const m = buildStoreByPlant([...LINKS, { plant_id: GANJAM, store_id: 's-other' }]);
    expect(storeIdForPlant(m, GANJAM)).toBe(GANJAM_STORE);
  });
});
