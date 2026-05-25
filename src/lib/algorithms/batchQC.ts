/**
 * Batch Yield QC Checker algorithm.
 *
 * When a batch is closed, the system:
 * 1. Looks up the Oil Ratio Table for the batch's gravity
 * 2. Computes expected yield from input paraffin weight
 * 3. Compares actual vs expected — flags if variance exceeds threshold
 */

export interface OilRatioEntry {
  gravity: number;
  np_ratio: number;      // NP consumption per unit
  waxol_ratio: number;   // Waxol ratio
  cl2_consumption: number; // Cl2 consumed per kg of NP
  hcl_output: number;    // HCL output per unit
}

export interface BatchQCInput {
  finalGravity: number;
  paraffinWeightKg: number;  // Input raw material weight
  actualDrumsFilled: number;
  actualHclQtyMT: number;
  oilRatioTable: OilRatioEntry[];
}

export interface BatchQCResult {
  expectedYieldDrums: number;
  actualYieldDrums: number;
  variancePct: number;
  expectedHclMT: number;
  actualHclMT: number;
  hclVariancePct: number;
  isPassed: boolean;
  isFlagged: boolean;
  message: string;
  referenceEntry: OilRatioEntry | null;
}

/** Variance threshold beyond which a batch is flagged for QC review */
export const VARIANCE_THRESHOLD_PCT = 3.0;

/**
 * Find the closest gravity entry in the Oil Ratio Table.
 * Uses exact match first, then nearest gravity.
 */
export function findOilRatioEntry(
  gravity: number,
  table: OilRatioEntry[]
): OilRatioEntry | null {
  if (!table.length) return null;

  // Exact match
  const exact = table.find((e) => e.gravity === gravity);
  if (exact) return exact;

  // Nearest match
  return table.reduce((prev, curr) =>
    Math.abs(curr.gravity - gravity) < Math.abs(prev.gravity - gravity) ? curr : prev
  );
}

/** One drum ≈ 240 kg of CP (standard Suntek drum) */
const KG_PER_DRUM = 240;
/** MT to KG */
const MT_TO_KG = 1000;

/**
 * Run QC check on a closed batch.
 */
export function runBatchQC(input: BatchQCInput): BatchQCResult {
  const { finalGravity, paraffinWeightKg, actualDrumsFilled, actualHclQtyMT, oilRatioTable } = input;

  const referenceEntry = findOilRatioEntry(finalGravity, oilRatioTable);

  if (!referenceEntry) {
    return {
      expectedYieldDrums: 0,
      actualYieldDrums: actualDrumsFilled,
      variancePct: 0,
      expectedHclMT: 0,
      actualHclMT: actualHclQtyMT,
      hclVariancePct: 0,
      isPassed: false,
      isFlagged: true,
      message: `No Oil Ratio entry found for gravity ${finalGravity}. QC cannot proceed.`,
      referenceEntry: null,
    };
  }

  // Expected CP yield from paraffin weight and NP ratio
  // np_ratio is the fraction of NP that becomes CP
  const expectedYieldKg = paraffinWeightKg * referenceEntry.np_ratio;
  const expectedYieldDrums = Math.round(expectedYieldKg / KG_PER_DRUM);
  const actualYieldDrums = actualDrumsFilled;

  const variancePct =
    expectedYieldDrums > 0
      ? ((actualYieldDrums - expectedYieldDrums) / expectedYieldDrums) * 100
      : 0;

  // Expected HCL output from Cl2 consumption × hcl_output ratio
  const expectedHclKg = paraffinWeightKg * referenceEntry.cl2_consumption * referenceEntry.hcl_output;
  const expectedHclMT = expectedHclKg / MT_TO_KG;
  const hclVariancePct =
    expectedHclMT > 0
      ? ((actualHclQtyMT - expectedHclMT) / expectedHclMT) * 100
      : 0;

  const isFlagged =
    Math.abs(variancePct) > VARIANCE_THRESHOLD_PCT ||
    Math.abs(hclVariancePct) > VARIANCE_THRESHOLD_PCT;

  const isPassed = !isFlagged;

  const message = isFlagged
    ? `QC FLAGGED: CP variance ${variancePct.toFixed(1)}%, HCL variance ${hclVariancePct.toFixed(1)}%. Exceeds ±${VARIANCE_THRESHOLD_PCT}% threshold. Review required.`
    : `QC PASSED: CP variance ${variancePct.toFixed(1)}%, HCL variance ${hclVariancePct.toFixed(1)}%. Within acceptable range.`;

  return {
    expectedYieldDrums,
    actualYieldDrums,
    variancePct,
    expectedHclMT,
    actualHclMT: actualHclQtyMT,
    hclVariancePct,
    isPassed,
    isFlagged,
    message,
    referenceEntry,
  };
}
