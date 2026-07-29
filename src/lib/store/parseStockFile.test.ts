import { describe, it, expect } from 'vitest';
import { resolveClosing } from './parseStockFile';

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
