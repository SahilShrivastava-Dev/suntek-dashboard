/**
 * True landed-cost engine (Phase 2, doc §3.2).
 *
 * Computes a real cost-per-batch and cost-per-MT from data the platform already
 * captures — material (recipe + actual consumption), labour (derived), an energy
 * estimate (rate × reactor-hours), and an overhead allocation — then derives
 * margin once a realised price is known.
 *
 * Rates live in CostConfig with sensible defaults the operator can tune in-app;
 * nothing here is hard-coded to one plant.
 */

export interface CostConfig {
  /** ₹ per kg of input paraffin (NP). */
  paraffinRatePerKg: number;
  /** ₹ per MT of chlorine (Cl2). */
  cl2RatePerMT: number;
  /** ₹ per reactor-hour (electricity + utilities estimate). */
  energyRatePerHour: number;
  /** ₹ of derived labour per MT of output. */
  labourPerMT: number;
  /** Overhead applied as a % of (material + labour + energy). */
  overheadPct: number;
}

/** Defaults — indicative only; tune per plant in the Cost Intelligence panel. */
export const DEFAULT_COST_CONFIG: CostConfig = {
  paraffinRatePerKg: 95,
  cl2RatePerMT: 32000,
  energyRatePerHour: 850,
  labourPerMT: 1450,
  overheadPct: 8,
};

export interface BatchCostInput {
  /** Input paraffin weight (kg). */
  paraffinWeightKg: number;
  /** Chlorine consumed (MT). */
  cl2QtyMT: number;
  /** Reactor run-time for the batch (hours). */
  reactorHours: number;
  /** Finished CP output (MT). */
  outputMT: number;
}

export interface BatchCostResult {
  materialCost: number;
  labourCost: number;
  energyCost: number;
  overheadCost: number;
  landedCost: number;
  /** Landed cost per MT of output (0 when output is 0). */
  costPerMT: number;
  breakdown: { label: string; value: number; pct: number }[];
}

/** Compute the landed cost of a single batch. */
export function computeBatchCost(
  input: BatchCostInput,
  config: CostConfig = DEFAULT_COST_CONFIG,
): BatchCostResult {
  const materialCost =
    input.paraffinWeightKg * config.paraffinRatePerKg +
    input.cl2QtyMT * config.cl2RatePerMT;
  const labourCost = input.outputMT * config.labourPerMT;
  const energyCost = input.reactorHours * config.energyRatePerHour;

  const subtotal = materialCost + labourCost + energyCost;
  const overheadCost = subtotal * (config.overheadPct / 100);
  const landedCost = subtotal + overheadCost;

  const costPerMT = input.outputMT > 0 ? landedCost / input.outputMT : 0;

  const pct = (v: number) => (landedCost > 0 ? (v / landedCost) * 100 : 0);
  const breakdown = [
    { label: 'Material', value: materialCost, pct: pct(materialCost) },
    { label: 'Labour', value: labourCost, pct: pct(labourCost) },
    { label: 'Energy', value: energyCost, pct: pct(energyCost) },
    { label: 'Overhead', value: overheadCost, pct: pct(overheadCost) },
  ];

  return { materialCost, labourCost, energyCost, overheadCost, landedCost, costPerMT, breakdown };
}

export interface MarginResult {
  landedCost: number;
  revenue: number;
  margin: number;
  /** Margin as a % of revenue (0 when revenue is 0). */
  marginPct: number;
  /** True when realised price is below the cost-plus-minimum floor. */
  belowFloor: boolean;
}

/**
 * Margin for a dispatch/batch given realised revenue and a minimum-margin floor.
 * @param minMarginPct floor as a % of cost (e.g. 10 = quote no lower than cost +10%).
 */
export function computeMargin(landedCost: number, revenue: number, minMarginPct = 10): MarginResult {
  const margin = revenue - landedCost;
  const marginPct = revenue > 0 ? (margin / revenue) * 100 : 0;
  const floorPrice = landedCost * (1 + minMarginPct / 100);
  return { landedCost, revenue, margin, marginPct, belowFloor: revenue < floorPrice };
}
