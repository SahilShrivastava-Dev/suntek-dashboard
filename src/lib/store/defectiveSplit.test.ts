import { describe, it, expect } from 'vitest';
import {
  validateSplit, isSplitValid, splitTotals, unaccounted, defaultReplacedQty, cleanPartName,
  type DefectiveSplitLine,
} from './defectiveSplit';

const line = (over: Partial<DefectiveSplitLine> = {}): DefectiveSplitLine => ({
  storeRequestId: 'sr1',
  partName: 'Valve 8 inch',
  replacedQty: 5,
  repairQty: 3,
  scrapQty: 2,
  ...over,
});

describe('validateSplit', () => {
  // The scenario from the bug report: 5 replaced → 3 repair + 2 scrap.
  it('accepts a balanced split', () => {
    expect(validateSplit([line()])).toEqual([]);
    expect(isSplitValid([line()])).toBe(true);
  });

  it('rejects a short split and reports how many are unaccounted for', () => {
    const errs = validateSplit([line({ repairQty: 3, scrapQty: 1 })]);
    expect(errs).toHaveLength(1);
    expect(errs[0].code).toBe('unbalanced');
    expect(errs[0].difference).toBe(-1); // one part missing
  });

  it('rejects over-allocating more than were replaced', () => {
    const errs = validateSplit([line({ repairQty: 4, scrapQty: 2 })]);
    expect(errs[0].code).toBe('unbalanced');
    expect(errs[0].difference).toBe(1);
  });

  it('rejects a non-positive replaced quantity', () => {
    expect(validateSplit([line({ replacedQty: 0, repairQty: 0, scrapQty: 0 })])[0].code)
      .toBe('replaced_not_positive');
  });

  it('rejects negative quantities', () => {
    expect(validateSplit([line({ repairQty: -1, scrapQty: 6 })])[0].code).toBe('negative');
  });

  it('rejects a blank part name', () => {
    expect(validateSplit([line({ partName: '  ' })])[0].code).toBe('missing_name');
  });

  it('rejects an empty form', () => {
    expect(validateSplit([])[0].code).toBe('no_lines');
  });

  // A ticket that replaced two different parts splits each independently.
  it('reports every offending line, not just the first', () => {
    const errs = validateSplit([
      line({ partName: 'Valve', repairQty: 1, scrapQty: 1 }),   // 2 of 5 → short
      line({ partName: 'Gasket', replacedQty: 2, repairQty: 2, scrapQty: 0 }), // ok
      line({ partName: 'O-ring', replacedQty: 3, repairQty: 0, scrapQty: 1 }), // short
    ]);
    expect(errs.map((e) => e.partName)).toEqual(['Valve', 'O-ring']);
  });
});

describe('unaccounted / splitTotals', () => {
  it('counts the units still unaccounted for', () => {
    expect(unaccounted(line())).toBe(0);
    expect(unaccounted(line({ repairQty: 1, scrapQty: 1 }))).toBe(3);
  });

  it('sums across lines for the ticket-level mirror', () => {
    expect(splitTotals([
      line({ replacedQty: 5, repairQty: 3, scrapQty: 2 }),
      line({ replacedQty: 2, repairQty: 2, scrapQty: 0 }),
    ])).toEqual({ replaced: 7, repair: 5, scrap: 2 });
  });
});

describe('cleanPartName', () => {
  // Ticket titles are "<equipment> — Needs part" / "— Repairable"; that suffix
  // must never reach the stock register as part of an item name.
  it('strips the workflow suffix from a ticket title', () => {
    expect(cleanPartName('Acid Pump ( EXP 50CT) Bello — Needs part')).toBe('Acid Pump ( EXP 50CT) Bello');
    expect(cleanPartName('GLC4 — Repairable')).toBe('GLC4');
  });

  it('handles hyphen and en-dash variants and odd spacing', () => {
    expect(cleanPartName('Valve 8 inch - Needs part')).toBe('Valve 8 inch');
    expect(cleanPartName('Valve 8 inch – Repairable')).toBe('Valve 8 inch');
    expect(cleanPartName('Valve 8 inch  —  needs   part  ')).toBe('Valve 8 inch');
  });

  it('leaves a genuine part name untouched', () => {
    expect(cleanPartName('Acid Pump ( EXP 50CT) Bello')).toBe('Acid Pump ( EXP 50CT) Bello');
    // "Repairable"/"Needs part" only strip as a trailing suffix, not mid-name.
    expect(cleanPartName('Needs part gasket')).toBe('Needs part gasket');
  });

  it('handles empty input', () => {
    expect(cleanPartName(null)).toBe('');
    expect(cleanPartName(undefined)).toBe('');
  });
});

describe('defaultReplacedQty', () => {
  // The reported bug: a request for 8 against a shelf of 24 defaulted to 24.
  it('uses the requested quantity, never the store on-hand level', () => {
    expect(defaultReplacedQty({ quantity: 8 })).toBe(8);
    // 3 pumps requested out of 100 in store → 3 replaced, not 100 (or 97).
    expect(defaultReplacedQty({ quantity: 3 })).toBe(3);
  });

  it('falls back to 1 when no quantity was recorded', () => {
    expect(defaultReplacedQty({ quantity: null })).toBe(1);
    expect(defaultReplacedQty({})).toBe(1);
    expect(defaultReplacedQty({ quantity: 0 })).toBe(1);
  });
});
