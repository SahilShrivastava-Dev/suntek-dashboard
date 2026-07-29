import { describe, it, expect } from 'vitest';
import { resolveClosing, reconcile, type MonthParse, type MonthItem } from './parseStockFile';

/**
 * The register was seeding from `opening + purchased − used`, which double-counts
 * whenever the Sales and Purchase sheets describe the SAME physical stock from
 * different angles. Verbatim from the client's workbook, July 2026:
 *
 *   3.5 SUT (7/16") 2" LENGTH
 *     Sales     Op Stock 50, no issues,       Closing 50
 *     Purchase  Opening   0, 50 bought day 7, Closing 50
 *
 * Both sheets agree the month ends at 50 — the same 50 units. The formula said
 * 100, and 44 of 515 items were inflated that way (2,010 units overstated).
 */
describe('resolveClosing — never sums the same stock twice', () => {
  it('uses the sheet\'s stated closing instead of re-deriving it', () => {
    // opening 50, purchased 50, used 0 → the old formula gave 100.
    expect(resolveClosing(50, 50, 50, 0)).toBe(50);
  });

  it('honours a stated closing of ZERO rather than falling back', () => {
    // 0 is a real balance, not "missing". Falling through here would resurrect
    // stock the sheet says is gone.
    expect(resolveClosing(0, 10, 0, 10)).toBe(0);
    expect(resolveClosing(0, 99, 99, 0)).toBe(0);
  });

  it('honours a stated negative closing', () => {
    // The sheet claiming below-zero is a bookkeeping error worth surfacing,
    // not something to silently recompute away.
    expect(resolveClosing(-1, 0, 0, 1)).toBe(-1);
  });

  it('falls back to opening + purchased − used when no closing is stated', () => {
    expect(resolveClosing(null, 10, 5, 3)).toBe(12);
    expect(resolveClosing(undefined, 10, 5, 3)).toBe(12);
  });

  it('falls back when the stated closing is not a finite number', () => {
    expect(resolveClosing(NaN, 7, 2, 1)).toBe(8);
    expect(resolveClosing(Infinity, 7, 2, 1)).toBe(8);
  });

  it('agrees with the formula when the sheets are consistent', () => {
    // Nothing purchased, 3 issued from 10 → both routes give 7.
    expect(resolveClosing(7, 10, 0, 3)).toBe(7);
  });
});

// ── The reconciliation rule, confirmed by the client ─────────────────────────
//   Sales "Op Stock"  ==  Purchase "Closing"   (same month, no offset)
const item = (o: Partial<MonthItem>): MonthItem => ({
  itemName: 'Widget', key: 'widget', unit: 'Pcs', equipment: '', model: null,
  opening: 0, purchaseOpening: 0, purchaseClosing: 0, purchased: 0, used: 0, closing: 0, ...o,
});
const month = (items: MonthItem[]): MonthParse => ({
  periodKey: '2026-07', periodMonth: '2026-07-01', label: 'July 2026',
  items, hasSales: true, hasPurchase: true,
});

describe('reconcile — Sales opening vs Purchase closing, same month', () => {
  it('is silent when the two sheets agree', () => {
    // Purchase: 0 + 50 received = 50 available. Sales carries 50 across.
    const a = reconcile(null, month([item({ opening: 50, purchaseOpening: 0, purchaseClosing: 50, purchased: 50, closing: 50 })]));
    expect(a.filter(x => x.type === 'intra_month')).toHaveLength(0);
  });

  it('flags a genuine disagreement and states both sides', () => {
    const a = reconcile(null, month([item({ opening: 49, purchaseClosing: 50, closing: 49 })]));
    const m = a.find(x => x.type === 'intra_month');
    expect(m).toBeDefined();
    expect(m!.detail).toContain('49');
    expect(m!.detail).toContain('50');
    expect(m!.delta).toBe(-1);
  });

  it('does NOT fire merely because stock was purchased', () => {
    // The old rule compared Sales opening to Purchase OPENING, so every item
    // bought during the month looked like an anomaly. 76+25 false positives.
    const a = reconcile(null, month([item({ opening: 14, purchaseOpening: 2, purchaseClosing: 14, purchased: 12, used: 1, closing: 13 })]));
    expect(a.filter(x => x.type === 'intra_month')).toHaveLength(0);
  });

  it('is independent of the cross-month check', () => {
    // Same-month reconciliation passes even when the month boundary does not:
    // the two are separate hand-offs and must be reported separately.
    const prev = month([item({ closing: 999 })]);
    const a = reconcile(prev, month([item({ opening: 5, purchaseOpening: 5, purchaseClosing: 5, closing: 5 })]));
    expect(a.some(x => x.type === 'intra_month')).toBe(false);   // sheets agree
    expect(a.some(x => x.type === 'carry_forward')).toBe(true);  // boundary does not
  });

  it('still reports an impossible closing', () => {
    const a = reconcile(null, month([item({ opening: 0, purchaseClosing: 0, used: 1, closing: -1 })]));
    expect(a.find(x => x.type === 'negative')).toBeDefined();
  });
});

describe('carry_forward — only when a previous month exists', () => {
  it('is SKIPPED when the workbook holds a single month', () => {
    // A file with only the latest month has nothing to hand over from. The
    // check must be skipped, not compared against zero — otherwise every item
    // in a one-month upload looks like stock appeared from nowhere.
    const a = reconcile(null, month([item({ opening: 20, purchaseOpening: 20, purchaseClosing: 20, closing: 20 })]));
    expect(a.some(x => x.type === 'carry_forward')).toBe(false);
    expect(a).toHaveLength(0);
  });

  it('is skipped for an item that is new this month', () => {
    const prev = month([item({ itemName: 'Old', key: 'old', closing: 5 })]);
    const a = reconcile(prev, month([item({ itemName: 'New', key: 'new', opening: 7, purchaseOpening: 7, purchaseClosing: 7, closing: 7 })]));
    expect(a.some(x => x.type === 'carry_forward')).toBe(false);
  });

  it('compares last month closing to this month PURCHASE opening', () => {
    const prev = month([item({ closing: 24 })]);
    const a = reconcile(prev, month([item({ opening: 151, purchaseOpening: 151, purchaseClosing: 151, closing: 151 })]));
    const cf = a.find(x => x.type === 'carry_forward');
    expect(cf).toBeDefined();
    expect(cf!.delta).toBe(127);          // Coupling 100: closed 24, reopened 151
    expect(cf!.severity).toBe('high');
  });

  it('does not fire when stock carries across cleanly', () => {
    const prev = month([item({ closing: 30 })]);
    // 30 carried in, 5 received -> 35 available, 35 copied to sales opening.
    const a = reconcile(prev, month([item({ opening: 35, purchaseOpening: 30, purchased: 5, purchaseClosing: 35, used: 0, closing: 35 })]));
    expect(a).toHaveLength(0);
  });
});

describe('sheet_self — a sheet contradicting its own arithmetic', () => {
  it('catches a hand-typed closing that BOTH books then agree on', () => {
    // Real row: Acid Pump (NZRP50200TBGV1J) Impeller O Ring.
    // 14 opening + 0 received = 14, but the purchase sheet states 20 — and the
    // sales sheet was copied from it, so intra_month stays silent.
    const a = reconcile(null, month([item({
      opening: 20, purchaseOpening: 14, purchased: 0, purchaseClosing: 20, used: 0, closing: 20,
    })]));
    expect(a.some(x => x.type === 'intra_month')).toBe(false);   // the books agree…
    const self = a.find(x => x.type === 'sheet_self');           // …but the maths does not
    expect(self).toBeDefined();
    expect(self!.detail).toContain('14');
    expect(self!.detail).toContain('20');
  });

  it('is silent when both sheets add up', () => {
    // 30 opening + 5 received = 35 available; 35 − 2 issued = 33 closing.
    const a = reconcile(null, month([item({
      opening: 35, purchaseOpening: 30, purchased: 5, purchaseClosing: 35, used: 2, closing: 33,
    })]));
    expect(a).toHaveLength(0);
  });
});
