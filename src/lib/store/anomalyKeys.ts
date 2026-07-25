/**
 * anomalyKeys — join the CLIENT-COMPUTED stock anomalies (reconcile() output,
 * ephemeral) to their PERSISTED review state (store_stock_anomalies, created
 * lazily the first time someone acts on one).
 *
 * The natural key is (plant_id, period_month, item_name, anomaly_type) — the
 * same tuple the DB enforces UNIQUE on — so a recomputed anomaly always finds
 * its stored resolution regardless of ordering or re-parsing.
 */
import type { Anomaly } from './parseStockFile';

export type AnomalyStatus = 'open' | 'confirmed' | 'false_positive' | 'resolved' | 'reopened';
export type AnomalyAction = 'confirm' | 'false_positive' | 'resolve' | 'reopen';

/** A persisted review row (subset of store_stock_anomalies we need client-side). */
export interface AnomalyResolutionRow {
  id: string;
  plant_id: string;
  period_month: string;         // 'YYYY-MM-DD' (first of month)
  item_name: string;
  anomaly_type: string;
  status: AnomalyStatus;
  action: string | null;
  corrected_value: number | null;
  resolution_comment: string | null;
  resolved_by_name: string | null;
  resolved_at: string | null;
  version: number;
}

/** Statuses that still count toward the "open anomalies" banner. */
export const OPEN_STATUSES: ReadonlySet<AnomalyStatus> = new Set(['open', 'confirmed', 'reopened']);

const normItem = (s: string) => s.trim().toLowerCase();

/** Stable join key. `periodMonth` must be the first-of-month date string the
 *  snapshots use (e.g. '2026-06-01'). */
export function anomalyKey(plantId: string, periodMonth: string, itemName: string, type: string): string {
  return [plantId, periodMonth, normItem(itemName), type].join('§');
}

export function keyForRow(r: Pick<AnomalyResolutionRow, 'plant_id' | 'period_month' | 'item_name' | 'anomaly_type'>): string {
  return anomalyKey(r.plant_id, r.period_month, r.item_name, r.anomaly_type);
}

/** Index persisted rows by natural key for O(1) lookup while rendering. */
export function indexResolutions(rows: AnomalyResolutionRow[]): Map<string, AnomalyResolutionRow> {
  const m = new Map<string, AnomalyResolutionRow>();
  for (const r of rows) m.set(keyForRow(r), r);
  return m;
}

/** A computed anomaly + its stored review state (if anyone acted on it yet). */
export interface ReviewedAnomaly {
  anomaly: Anomaly;
  plantId: string;
  periodMonth: string;
  resolution: AnomalyResolutionRow | null;
  /** open/confirmed/reopened (or never reviewed) → still counts as open. */
  isOpen: boolean;
}

export function joinAnomalies(
  computed: { anomaly: Anomaly; plantId: string; periodMonth: string }[],
  resolutions: Map<string, AnomalyResolutionRow>,
): ReviewedAnomaly[] {
  return computed.map(({ anomaly, plantId, periodMonth }) => {
    const res = resolutions.get(anomalyKey(plantId, periodMonth, anomaly.item, anomaly.type)) ?? null;
    return {
      anomaly, plantId, periodMonth, resolution: res,
      isOpen: res == null || OPEN_STATUSES.has(res.status),
    };
  });
}
