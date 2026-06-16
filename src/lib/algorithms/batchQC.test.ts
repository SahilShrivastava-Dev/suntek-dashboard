import { describe, it, expect } from 'vitest';
import {
  runBatchQC,
  findOilRatioEntry,
  VARIANCE_THRESHOLD_PCT,
  type OilRatioEntry,
} from './batchQC';

const TABLE: OilRatioEntry[] = [
  { gravity: 1300, np_ratio: 1.2, waxol_ratio: 0.1, cl2_consumption: 0.5, hcl_output: 0.6 },
  { gravity: 1400, np_ratio: 1.3, waxol_ratio: 0.1, cl2_consumption: 0.55, hcl_output: 0.62 },
  { gravity: 1500, np_ratio: 1.4, waxol_ratio: 0.1, cl2_consumption: 0.6, hcl_output: 0.65 },
];

describe('findOilRatioEntry', () => {
  it('returns null for an empty table', () => {
    expect(findOilRatioEntry(1300, [])).toBeNull();
  });

  it('returns the exact gravity match when present', () => {
    expect(findOilRatioEntry(1400, TABLE)?.gravity).toBe(1400);
  });

  it('falls back to the nearest gravity when no exact match', () => {
    expect(findOilRatioEntry(1420, TABLE)?.gravity).toBe(1400);
    expect(findOilRatioEntry(1460, TABLE)?.gravity).toBe(1500);
  });
});

describe('runBatchQC', () => {
  it('flags when no oil-ratio entry can be resolved (empty table)', () => {
    const r = runBatchQC({
      finalGravity: 1300,
      paraffinWeightKg: 1000,
      actualDrumsFilled: 5,
      actualHclQtyMT: 0.3,
      oilRatioTable: [],
    });
    expect(r.referenceEntry).toBeNull();
    expect(r.isFlagged).toBe(true);
    expect(r.isPassed).toBe(false);
  });

  it('passes when actual yield matches expected within threshold', () => {
    // gravity 1300 → np_ratio 1.2 → expectedYieldKg = 1000 * 1.2 = 1200 → /240 = 5 drums
    // expectedHclKg = 1000 * 0.5 * 0.6 = 300 → 0.3 MT
    const r = runBatchQC({
      finalGravity: 1300,
      paraffinWeightKg: 1000,
      actualDrumsFilled: 5,
      actualHclQtyMT: 0.3,
      oilRatioTable: TABLE,
    });
    expect(r.expectedYieldDrums).toBe(5);
    expect(r.expectedHclMT).toBeCloseTo(0.3, 5);
    expect(r.variancePct).toBe(0);
    expect(r.hclVariancePct).toBeCloseTo(0, 5);
    expect(r.isPassed).toBe(true);
    expect(r.isFlagged).toBe(false);
  });

  it('flags a CP yield variance beyond the threshold', () => {
    // expected 5 drums, actual 6 → +20% variance > 3%
    const r = runBatchQC({
      finalGravity: 1300,
      paraffinWeightKg: 1000,
      actualDrumsFilled: 6,
      actualHclQtyMT: 0.3,
      oilRatioTable: TABLE,
    });
    expect(r.variancePct).toBeCloseTo(20, 5);
    expect(r.isFlagged).toBe(true);
    expect(r.message).toContain('QC FLAGGED');
  });

  it('flags an HCL variance beyond the threshold even when CP yield is fine', () => {
    const r = runBatchQC({
      finalGravity: 1300,
      paraffinWeightKg: 1000,
      actualDrumsFilled: 5,
      actualHclQtyMT: 0.45, // expected 0.3 → +50%
      oilRatioTable: TABLE,
    });
    expect(Math.abs(r.variancePct)).toBeLessThanOrEqual(VARIANCE_THRESHOLD_PCT);
    expect(Math.abs(r.hclVariancePct)).toBeGreaterThan(VARIANCE_THRESHOLD_PCT);
    expect(r.isFlagged).toBe(true);
  });
});
