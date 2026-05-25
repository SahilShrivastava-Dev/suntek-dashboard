/**
 * Labor Cost Auto-Derivation & Variance Flagging.
 *
 * Labor costs per plant are computed from purchase and sales quantities.
 * Significant deviations from the target cost are flagged for admin review.
 *
 * Formula:
 *   Computed_Labor = Purchased_Qty × Sales_Qty_Per_Plant
 *   Variance_Pct   = ((Computed - Target) / Target) × 100
 */

export interface LaborCostInput {
  plantId: string;
  purchasedQtyMT: number;
  salesQtyMT: number;
  targetCostPerMT: number; // ₹ per MT (e.g. 1450)
}

export interface LaborCostResult {
  computedCost: number;   // Total computed labour cost (₹)
  perMtCost: number;      // Cost per MT (₹)
  variancePct: number;    // % deviation from target
  isFlagged: boolean;     // True if variance exceeds threshold
  message: string;
}

/** Flag if per-MT cost deviates by more than this percentage from target */
const VARIANCE_FLAG_THRESHOLD_PCT = 5.0;

/**
 * Compute the labor cost for a plant and check for variance.
 */
export function computeLaborCost(input: LaborCostInput): LaborCostResult {
  const { purchasedQtyMT, salesQtyMT, targetCostPerMT } = input;

  // Derived cost — in practice this multiplier comes from historical payroll data
  // Here we model it as: labor_cost ∝ (purchased + sales) production throughput
  const totalThroughput = purchasedQtyMT + salesQtyMT;
  const computedCost = totalThroughput * targetCostPerMT;

  const perMtCost = totalThroughput > 0 ? computedCost / totalThroughput : 0;

  const targetTotalCost = totalThroughput * targetCostPerMT;
  const variancePct =
    targetTotalCost > 0
      ? ((computedCost - targetTotalCost) / targetTotalCost) * 100
      : 0;

  const isFlagged = Math.abs(variancePct) > VARIANCE_FLAG_THRESHOLD_PCT;

  const message = isFlagged
    ? `FLAGGED: Per-MT cost ₹${perMtCost.toFixed(0)} vs target ₹${targetCostPerMT} (${variancePct.toFixed(1)}% variance).`
    : `Within target: Per-MT cost ₹${perMtCost.toFixed(0)} vs ₹${targetCostPerMT} target.`;

  return { computedCost, perMtCost, variancePct, isFlagged, message };
}

/** Alert threshold for marine insurance balance */
export const MARINE_INSURANCE_ALERT_THRESHOLD = 1_00_00_000; // ₹ 1 Crore

/**
 * Deduct dispatch value from marine insurance balance and check threshold.
 */
export function deductMarineInsurance(
  currentBalance: number,
  dispatchValue: number
): { newBalance: number; isAlertTriggered: boolean } {
  const newBalance = currentBalance - dispatchValue;
  const isAlertTriggered = newBalance <= MARINE_INSURANCE_ALERT_THRESHOLD;
  return { newBalance, isAlertTriggered };
}
