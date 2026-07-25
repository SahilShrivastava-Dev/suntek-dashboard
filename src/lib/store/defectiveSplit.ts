/**
 * defectiveSplit — the Repair / Scrap split a technician records when closing a
 * maintenance ticket.
 *
 * A job that replaced 5 parts must say what happened to all 5: e.g. 3 sent for
 * repair, 2 scrapped. The old model stored ONE decision for the whole ticket
 * with no quantity, so multi-part jobs silently collapsed to a single unit.
 *
 * The balance rule (repair + scrap = replaced) is enforced three times over: in
 * this helper for live UI feedback, by the record_defective_disposition RPC,
 * and by a CHECK constraint on maintenance_defective_parts. This module is the
 * fast, testable copy — the DB is the authority.
 */

/**
 * A maintenance ticket's `title` is built at raise time as
 * `"<equipment> — Repairable"` / `"<equipment> — Needs part"`, so it is NOT a
 * part name — it is the equipment plus a workflow suffix. Using it verbatim as
 * a stock item name (as the old repair flow did) produces entries like
 * "Acid Pump ( EXP 50CT) Bello — Needs part", which then fail to fuzzy-match
 * the real register row and get created as duplicates.
 *
 * Strips that suffix so a ticket-derived name can at least match the register.
 * Prefer a real `maintenance_store_requests.part_name` whenever one exists.
 */
export function cleanPartName(raw: string | null | undefined): string {
  return (raw || '')
    .replace(/\s*[—–-]\s*(Repairable|Needs\s+part)\s*$/i, '')
    .trim();
}

/** One replaced part line being dispositioned. */
export interface DefectiveSplitLine {
  /** Store-request line these parts came from (null for free-text parts). */
  storeRequestId: string | null;
  partName: string;
  /** How many units were actually swapped out. Defaults to the qty handed over. */
  replacedQty: number;
  repairQty: number;
  scrapQty: number;
  /** Register row the repaired units should return into, when known. */
  storeItemId?: string | null;
}

export type SplitErrorCode =
  | 'no_lines'
  | 'missing_name'
  | 'replaced_not_positive'
  | 'negative'
  | 'unbalanced';

export interface SplitError {
  code: SplitErrorCode;
  /** Index of the offending line, or -1 for whole-form errors. */
  index: number;
  partName?: string;
  /** repair + scrap − replaced. Positive = over-allocated, negative = short. */
  difference?: number;
}

/** Units still unaccounted for on a line (replaced − repair − scrap). */
export function unaccounted(line: DefectiveSplitLine): number {
  return num(line.replacedQty) - num(line.repairQty) - num(line.scrapQty);
}

function num(v: number | string | null | undefined): number {
  const n = typeof v === 'string' ? Number(v) : v ?? 0;
  return Number.isFinite(n) ? (n as number) : 0;
}

/**
 * Validate the whole form. Returns every problem so the UI can mark each row,
 * rather than stopping at the first.
 */
export function validateSplit(lines: DefectiveSplitLine[]): SplitError[] {
  if (!lines.length) return [{ code: 'no_lines', index: -1 }];
  const errors: SplitError[] = [];
  lines.forEach((l, i) => {
    if (!l.partName.trim()) {
      errors.push({ code: 'missing_name', index: i });
      return;
    }
    const replaced = num(l.replacedQty);
    const repair = num(l.repairQty);
    const scrap = num(l.scrapQty);
    if (replaced <= 0) {
      errors.push({ code: 'replaced_not_positive', index: i, partName: l.partName });
      return;
    }
    if (repair < 0 || scrap < 0) {
      errors.push({ code: 'negative', index: i, partName: l.partName });
      return;
    }
    if (repair + scrap !== replaced) {
      errors.push({ code: 'unbalanced', index: i, partName: l.partName, difference: repair + scrap - replaced });
    }
  });
  return errors;
}

export const isSplitValid = (lines: DefectiveSplitLine[]): boolean => validateSplit(lines).length === 0;

/** Totals for the summary strip + the ticket-level mirror. */
export function splitTotals(lines: DefectiveSplitLine[]): { replaced: number; repair: number; scrap: number } {
  return lines.reduce(
    (acc, l) => ({
      replaced: acc.replaced + num(l.replacedQty),
      repair: acc.repair + num(l.repairQty),
      scrap: acc.scrap + num(l.scrapQty),
    }),
    { replaced: 0, repair: 0, scrap: 0 },
  );
}

/**
 * Default "replaced" count for a request line: THE QUANTITY REQUESTED ON THE
 * TICKET. If a job asked for 3 reactor pumps, 3 old ones came out — regardless
 * of whether the store held 100 (or 97 after issuing).
 *
 * Deliberately ignores `qty_in_store`, which is the store's ON-HAND level, not
 * the amount issued. Reading it made a request for 8 against a shelf of 24
 * default to 24 replaced parts.
 *
 * This is only the default — the technician can edit it before submitting if
 * fewer parts were actually swapped.
 */
export function defaultReplacedQty(req: { quantity?: number | null }): number {
  return Math.max(num(req.quantity), 1);
}
