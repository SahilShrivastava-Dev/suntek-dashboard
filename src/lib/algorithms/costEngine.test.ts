import { describe, it, expect } from 'vitest';
import { computeBatchCost, computeMargin, type CostConfig } from './costEngine';

const CONFIG: CostConfig = {
  paraffinRatePerKg: 100,
  cl2RatePerMT: 30000,
  energyRatePerHour: 1000,
  labourPerMT: 1000,
  overheadPct: 10,
};

describe('computeBatchCost', () => {
  it('sums material, labour, energy and overhead into a landed cost', () => {
    // material = 1000kg*100 + 0.5MT*30000 = 100000 + 15000 = 115000
    // labour   = 10MT * 1000 = 10000
    // energy   = 4h * 1000 = 4000
    // subtotal = 129000 ; overhead 10% = 12900 ; landed = 141900
    const r = computeBatchCost({ paraffinWeightKg: 1000, cl2QtyMT: 0.5, reactorHours: 4, outputMT: 10 }, CONFIG);
    expect(r.materialCost).toBe(115000);
    expect(r.labourCost).toBe(10000);
    expect(r.energyCost).toBe(4000);
    expect(r.overheadCost).toBe(12900);
    expect(r.landedCost).toBe(141900);
    expect(r.costPerMT).toBeCloseTo(14190, 5);
  });

  it('returns 0 cost-per-MT when there is no output (no divide-by-zero)', () => {
    const r = computeBatchCost({ paraffinWeightKg: 100, cl2QtyMT: 0, reactorHours: 1, outputMT: 0 }, CONFIG);
    expect(r.costPerMT).toBe(0);
  });

  it('breakdown percentages sum to ~100', () => {
    const r = computeBatchCost({ paraffinWeightKg: 1000, cl2QtyMT: 0.5, reactorHours: 4, outputMT: 10 }, CONFIG);
    const total = r.breakdown.reduce((s, b) => s + b.pct, 0);
    expect(total).toBeCloseTo(100, 5);
  });
});

describe('computeMargin', () => {
  it('computes margin and margin %', () => {
    const r = computeMargin(80, 100, 10);
    expect(r.margin).toBe(20);
    expect(r.marginPct).toBeCloseTo(20, 5);
    expect(r.belowFloor).toBe(false); // floor = 80*1.1 = 88; revenue 100 >= 88
  });

  it('flags below the cost-plus-minimum floor', () => {
    // floor = 100 * 1.10 = 110; revenue 105 < 110 → below floor
    const r = computeMargin(100, 105, 10);
    expect(r.belowFloor).toBe(true);
  });

  it('handles zero revenue without dividing by zero', () => {
    const r = computeMargin(100, 0, 10);
    expect(r.marginPct).toBe(0);
    expect(r.belowFloor).toBe(true);
  });
});
