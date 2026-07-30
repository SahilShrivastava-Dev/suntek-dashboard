import { describe, it, expect } from 'vitest';
import { anomalyKey, indexResolutions, joinAnomalies, OPEN_STATUSES, type AnomalyResolutionRow } from './anomalyKeys';
import type { Anomaly } from './parseStockFile';

const anom = (over: Partial<Anomaly> = {}): Anomaly => ({
  type: 'carry_forward',
  item: 'Acid Pump ( EXP 50CT) Bello',
  detail: 'Last month closed at 31, this month opens at 29 (-2).',
  severity: 'medium',
  prev: 31, curr: 29, delta: -2,
  ...over,
} as Anomaly);

const row = (over: Partial<AnomalyResolutionRow> = {}): AnomalyResolutionRow => ({
  // store_id is the join key since migration 72; plant_id remains as the
  // informational owning factory (null for a shared store).
  id: 'r1', plant_id: 'p1', store_id: 'p1', period_month: '2026-06-01',
  item_name: 'Acid Pump ( EXP 50CT) Bello', anomaly_type: 'carry_forward',
  status: 'resolved', action: 'resolve', corrected_value: null,
  resolution_comment: 'verified against physical count', resolved_by_name: 'Sagar',
  resolved_at: '2026-07-20T10:00:00Z', version: 2,
  ...over,
});

describe('anomalyKey', () => {
  it('is case/whitespace-insensitive on the item name only', () => {
    expect(anomalyKey('p1', '2026-06-01', '  ACID pump ', 'negative'))
      .toBe(anomalyKey('p1', '2026-06-01', 'Acid Pump', 'negative'));
    expect(anomalyKey('p1', '2026-06-01', 'Acid Pump', 'negative'))
      .not.toBe(anomalyKey('p2', '2026-06-01', 'Acid Pump', 'negative'));
  });
});

describe('joinAnomalies', () => {
  const computed = [{ anomaly: anom(), plantId: 'p1', periodMonth: '2026-06-01' }];

  it('matches a computed anomaly to its persisted resolution', () => {
    const joined = joinAnomalies(computed, indexResolutions([row()]));
    expect(joined[0].resolution?.id).toBe('r1');
    expect(joined[0].isOpen).toBe(false); // resolved → no longer open
  });

  it('treats never-reviewed anomalies as open', () => {
    const joined = joinAnomalies(computed, indexResolutions([]));
    expect(joined[0].resolution).toBeNull();
    expect(joined[0].isOpen).toBe(true);
  });

  it('keeps confirmed and reopened anomalies in the open count, drops false positives', () => {
    for (const status of ['confirmed', 'reopened'] as const) {
      const joined = joinAnomalies(computed, indexResolutions([row({ status })]));
      expect(joined[0].isOpen).toBe(true);
    }
    const fp = joinAnomalies(computed, indexResolutions([row({ status: 'false_positive' })]));
    expect(fp[0].isOpen).toBe(false);
  });

  it('does not cross-match different months or types', () => {
    const other = indexResolutions([row({ period_month: '2026-05-01' })]);
    expect(joinAnomalies(computed, other)[0].resolution).toBeNull();
  });
});

describe('OPEN_STATUSES', () => {
  it('covers exactly open/confirmed/reopened', () => {
    expect([...OPEN_STATUSES].sort()).toEqual(['confirmed', 'open', 'reopened']);
  });
});
