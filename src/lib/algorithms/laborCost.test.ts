import { describe, it, expect } from 'vitest';
import {
  computeLaborCost,
  deductMarineInsurance,
  MARINE_INSURANCE_ALERT_THRESHOLD,
} from './laborCost';

describe('computeLaborCost', () => {
  it('computes total and per-MT cost from throughput', () => {
    const r = computeLaborCost({
      plantId: 'rehla',
      purchasedQtyMT: 100,
      salesQtyMT: 50,
      targetCostPerMT: 1450,
    });
    expect(r.computedCost).toBe(150 * 1450);
    expect(r.perMtCost).toBeCloseTo(1450, 5);
  });

  it('returns zero per-MT cost when there is no throughput', () => {
    const r = computeLaborCost({
      plantId: 'rehla',
      purchasedQtyMT: 0,
      salesQtyMT: 0,
      targetCostPerMT: 1450,
    });
    expect(r.perMtCost).toBe(0);
    expect(r.variancePct).toBe(0);
  });

  // KNOWN LIMITATION (tracked for Track A / A2): the current placeholder derives
  // computedCost and targetTotalCost from the SAME formula (throughput × target),
  // so variancePct is structurally always 0 and isFlagged can never be true.
  // This test documents current behaviour; the real payroll-derived cost must be
  // wired in before labour variance flagging is meaningful.
  it('never flags variance with the current placeholder formula (documented limitation)', () => {
    const r = computeLaborCost({
      plantId: 'shd',
      purchasedQtyMT: 999,
      salesQtyMT: 1,
      targetCostPerMT: 9999,
    });
    expect(r.variancePct).toBe(0);
    expect(r.isFlagged).toBe(false);
  });
});

describe('deductMarineInsurance', () => {
  it('subtracts the dispatch value from the balance', () => {
    const r = deductMarineInsurance(10_00_00_000, 50_00_000);
    expect(r.newBalance).toBe(9_50_00_000);
    expect(r.isAlertTriggered).toBe(false);
  });

  it('triggers an alert when the balance falls to or below ₹1 Cr', () => {
    const r = deductMarineInsurance(1_20_00_000, 30_00_000);
    expect(r.newBalance).toBe(MARINE_INSURANCE_ALERT_THRESHOLD - 10_00_000);
    expect(r.isAlertTriggered).toBe(true);
  });

  it('triggers an alert exactly at the threshold', () => {
    const r = deductMarineInsurance(MARINE_INSURANCE_ALERT_THRESHOLD + 50, 50);
    expect(r.newBalance).toBe(MARINE_INSURANCE_ALERT_THRESHOLD);
    expect(r.isAlertTriggered).toBe(true);
  });
});
