/**
 * Purchase-date normalisation for the FAR importer.
 *
 * Lives here rather than inside FAR.tsx because it is the single most
 * error-prone step in the import: a client workbook's date column is free text
 * filled in by hand over years, and one bad cell used to fail the ENTIRE
 * import with an unreadable database error.
 *
 * ═══ THE BUG THIS EXISTS TO PREVENT ═══════════════════════════════════════
 * The previous version ended with `new Date(v).toISOString().slice(0, 10)`.
 * When a value parses to a year outside 0000–9999, toISOString() switches to
 * the EXPANDED year format and slice(0, 10) chops it into nonsense:
 *
 *     "99999-1-1"  →  "+099998-12"
 *
 * Postgres reads that leading "+" as a timezone displacement and rejects the
 * whole batch with `22009 invalid_time_zone_displacement_value` — a client
 * hitting exactly this could not import their FAR at all, while the same
 * importer worked fine on a file that happened to have no such cell.
 *
 * The rule here: this function may return a well-formed 'YYYY-MM-DD' inside a
 * plausible range, or null. Never anything else. A date we cannot make sense
 * of becomes null — one blank field on one asset — rather than a rejection
 * that loses all 210 rows.
 */
import * as XLSX from 'xlsx';

/**
 * A purchase date outside this range is a parse artefact, not a fact. Factory
 * plant is not bought before 1900, and a future-dated purchase beyond 2100 is
 * a typo or a misread serial. Both ends exist to stop garbage reaching the DB.
 */
const MIN_YEAR = 1900;
const MAX_YEAR = 2100;

const pad = (n: number) => String(n).padStart(2, '0');

/** Build 'YYYY-MM-DD' from UTC parts, or null when out of range.
 *  Deliberately avoids toISOString(), whose expanded-year format is the source
 *  of the malformed output described above. */
function isoDay(dt: Date): string | null {
  const y = dt.getUTCFullYear();
  if (!Number.isFinite(y) || y < MIN_YEAR || y > MAX_YEAR) return null;
  return `${String(y).padStart(4, '0')}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** Final gate: only a plain, in-range calendar date may leave this module. */
function accept(s: string | null): string | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  if (y < MIN_YEAR || y > MAX_YEAR) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return s;
}

/**
 * Normalise one purchase-date cell to 'YYYY-MM-DD', or null if it cannot be
 * read as a date. Never throws, and never returns a malformed string.
 */
export function normalizeAssetDate(raw: unknown): string | null {
  const v = raw == null ? '' : String(raw).trim();
  if (!v) return null;

  // ── A bare four-digit YEAR ────────────────────────────────────────────────
  // Checked BEFORE the Excel-serial branch, which would otherwise read "2011"
  // as serial 2011 = 3 July 1905 — silently recording a plausible-looking but
  // completely wrong purchase date. Client FAR sheets very often carry just a
  // year, and a real Excel date serial for any modern date is 5 digits
  // (25569 = 1970, 45000 = 2023), so a 4-digit value in this range is a year.
  if (/^\d{4}$/.test(v)) {
    const y = Number(v);
    if (y >= MIN_YEAR && y <= MAX_YEAR) return accept(`${y}-01-01`);
  }

  // ── An Excel date serial ──────────────────────────────────────────────────
  // FIVE digits only. Every 4-digit serial lands between 1902 and 1927, which
  // is never a real purchase date for this equipment — a 4-digit number in this
  // column is a year (handled above) or a typo, and reading it as a serial just
  // invents a plausible-looking 1900s date nobody would question. Genuine
  // modern serials are 5 digits (25569 = 1970, 45000 = 2023).
  if (/^\d{5}$/.test(v)) {
    try {
      const d = XLSX.SSF ? XLSX.SSF.parse_date_code(Number(v)) : null;
      if (d && d.y) return accept(`${d.y}-${pad(d.m)}-${pad(d.d)}`);
    } catch { /* fall through to text parsing */ }
    return null;
  }

  // ── DAY-FIRST dd.mm.yyyy / dd-mm-yyyy / dd/mm/yyyy ────────────────────────
  // Handled explicitly, BEFORE new Date(), because JavaScript reads dotted and
  // slashed dates as MONTH-first. On the client's register that is wrong twice
  // over: "29.07.2017" is rejected outright (there is no month 29), and
  // "05.12.2011" silently becomes 11 May instead of 5 December. 58 of 79 dated
  // rows were being dropped and most of the rest quietly mis-dated.
  //
  // Day-first is the right default here: the workbooks are Indian (the app is
  // IST/₹/en-IN throughout) and this file settles it beyond doubt — it contains
  // days above 12 in the first position and never in the second.
  const dmy = /^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})\b/.exec(v);
  if (dmy) {
    let [, d, m, y] = dmy;
    let day = Number(d), mon = Number(m);
    // A first component above 12 can only be a day; if the SECOND is above 12
    // the file is month-first for this row, so swap rather than discard it.
    if (day <= 12 && mon > 12) { const t = day; day = mon; mon = t; }
    let year = Number(y);
    if (y.length === 2) year += year < 70 ? 2000 : 1900;   // '24 → 2024, '98 → 1998
    if (mon >= 1 && mon <= 12 && day >= 1 && day <= 31) {
      const built = accept(`${String(year).padStart(4, '0')}-${pad(mon)}-${pad(day)}`);
      // Reject an impossible calendar day (31 Feb) rather than letting Postgres
      // take the whole batch down for it.
      if (built) {
        const probe = new Date(`${built}T00:00:00Z`);
        if (!isNaN(probe.getTime()) && probe.getUTCDate() === day) return built;
      }
    }
    return null;
  }

  // ── Anything else: let the runtime try, then validate hard ────────────────
  const dt = new Date(v);
  if (isNaN(dt.getTime())) return null;
  return accept(isoDay(dt));
}
