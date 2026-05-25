/**
 * Dynamic Pricing — Density Spread Algorithm.
 *
 * Chemical density fluctuates daily. When goods are dispatched, the actual
 * density of the product may differ from the density locked in the sales contract.
 * This algorithm adjusts the final price to reflect that difference.
 *
 * Formula:
 *   Final_Price = Locked_Contract_Price + ((Actual_Density - Preferred_Density) × Spread_Multiplier)
 */

export interface DensityPricingInput {
  lockedContractPrice: number;   // Price per drum locked in contract (₹)
  preferredDensity: number;      // Density agreed in contract (e.g. 1300)
  actualDensity: number;         // Actual density of dispatched batch
  spreadMultiplierPerUnit?: number; // ₹ per density unit (default: 50 ₹/unit)
}

export interface DensityPricingResult {
  finalPrice: number;
  densityDelta: number;
  priceAdjustment: number;
  isAdjusted: boolean;
  description: string;
}

const DEFAULT_SPREAD_MULTIPLIER = 50; // ₹ per density unit

/**
 * Calculate the adjusted dispatch price based on actual vs. contracted density.
 */
export function calculateDispatchPrice(input: DensityPricingInput): DensityPricingResult {
  const {
    lockedContractPrice,
    preferredDensity,
    actualDensity,
    spreadMultiplierPerUnit = DEFAULT_SPREAD_MULTIPLIER,
  } = input;

  const densityDelta = actualDensity - preferredDensity;
  const priceAdjustment = densityDelta * spreadMultiplierPerUnit;
  const finalPrice = lockedContractPrice + priceAdjustment;
  const isAdjusted = densityDelta !== 0;

  const description = isAdjusted
    ? `Density spread applied: ${densityDelta > 0 ? '+' : ''}${densityDelta} units × ₹${spreadMultiplierPerUnit} = ${priceAdjustment >= 0 ? '+' : ''}₹${priceAdjustment.toLocaleString('en-IN')} adjustment`
    : 'Density matches contract — no spread applied';

  return { finalPrice, densityDelta, priceAdjustment, isAdjusted, description };
}
