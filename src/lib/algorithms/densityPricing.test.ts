import { describe, it, expect } from 'vitest';
import { calculateDispatchPrice } from './densityPricing';

describe('calculateDispatchPrice', () => {
  it('applies no adjustment when actual density matches the contract', () => {
    const r = calculateDispatchPrice({
      lockedContractPrice: 85,
      preferredDensity: 1400,
      actualDensity: 1400,
    });
    expect(r.densityDelta).toBe(0);
    expect(r.priceAdjustment).toBe(0);
    expect(r.finalPrice).toBe(85);
    expect(r.isAdjusted).toBe(false);
    expect(r.description).toContain('no spread');
  });

  it('adds a positive adjustment when actual density exceeds preferred', () => {
    // delta +10 × ₹50 = +₹500
    const r = calculateDispatchPrice({
      lockedContractPrice: 20_400,
      preferredDensity: 1400,
      actualDensity: 1410,
    });
    expect(r.densityDelta).toBe(10);
    expect(r.priceAdjustment).toBe(500);
    expect(r.finalPrice).toBe(20_900);
    expect(r.isAdjusted).toBe(true);
  });

  it('subtracts when actual density is below preferred', () => {
    const r = calculateDispatchPrice({
      lockedContractPrice: 1000,
      preferredDensity: 1500,
      actualDensity: 1480,
    });
    expect(r.densityDelta).toBe(-20);
    expect(r.priceAdjustment).toBe(-1000);
    expect(r.finalPrice).toBe(0);
  });

  it('honours a custom spread multiplier', () => {
    const r = calculateDispatchPrice({
      lockedContractPrice: 100,
      preferredDensity: 1300,
      actualDensity: 1310,
      spreadMultiplierPerUnit: 75,
    });
    expect(r.priceAdjustment).toBe(750);
    expect(r.finalPrice).toBe(850);
  });
});
