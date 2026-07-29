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

  it('never compares across months', () => {
    // Even with a previous month whose closing differs wildly, no carry-forward
    // anomaly is raised — the client's rule is same-month only.
    const prev = month([item({ closing: 999 })]);
    const a = reconcile(prev, month([item({ opening: 5, purchaseClosing: 5, closing: 5 })]));
    expect(a.some(x => x.type === 'carry_forward')).toBe(false);
  });

  it('still reports an impossible closing', () => {
    const a = reconcile(null, month([item({ opening: 0, purchaseClosing: 0, used: 1, closing: -1 })]));
    expect(a.find(x => x.type === 'negative')).toBeDefined();
  });
});
