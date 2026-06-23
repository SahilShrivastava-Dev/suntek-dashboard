/**
 * Fuzzy string similarity for blacklist screening.
 *
 * Pure, dependency-free. Combines several measures so it catches the ways a
 * blacklisted entity actually slips through on data entry / OCR:
 *  - exact (after normalisation)            → "Acme Traders" vs "acme  traders."
 *  - Levenshtein ratio (typos / OCR errors) → "Rajesh Kumar" vs "Rajsh Kumar"
 *  - token-set overlap (re-ordering)        → "Kumar Rajesh" vs "Rajesh Kumar"
 *  - containment (sub-string / extra words) → "Acme" vs "Acme Traders Pvt Ltd"
 *  - id-normalised match (vehicle/GST nos.)  → "MH-12 AB 1234" vs "mh12ab1234"
 *
 * similarity() returns 0..1. A later semantic (embedding) layer can be added
 * alongside this without changing callers — see screenCandidates().
 */

/** Lower-case, accent-fold, strip punctuation, collapse whitespace. */
export function normalize(s: string): string {
  return (s ?? '')
    .toString()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')   // drop combining diacritics
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Strip everything but alphanumerics — for identifiers (vehicle no., GSTIN…). */
export function normalizeId(s: string): string {
  return (s ?? '').toString().toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Classic Levenshtein edit distance. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/** 1 - normalised edit distance, in 0..1. */
export function levRatio(a: string, b: string): number {
  if (!a.length && !b.length) return 1;
  const max = Math.max(a.length, b.length);
  if (!max) return 0;
  return 1 - levenshtein(a, b) / max;
}

/** Jaccard overlap of the two strings' word-token sets (order-insensitive). */
export function tokenSetRatio(a: string, b: string): number {
  const sa = new Set(a.split(' ').filter(Boolean));
  const sb = new Set(b.split(' ').filter(Boolean));
  if (!sa.size || !sb.size) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  return inter / (sa.size + sb.size - inter);
}

/** Combined free-text similarity, 0..1. */
export function similarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const lev = levRatio(na, nb);
  const tok = tokenSetRatio(na, nb);
  // Containment: a short blacklisted token fully inside a longer entry (or v.v.)
  // is a strong signal, but cap it below an exact match.
  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length <= nb.length ? nb : na;
  const contain = shorter.length >= 3 && longer.includes(shorter) ? 0.92 : 0;
  return Math.max(lev, tok, contain);
}

/** Identifier similarity (vehicle no., GSTIN…) on the alphanumeric form. */
export function identifierSimilarity(a: string, b: string): number {
  const na = normalizeId(a);
  const nb = normalizeId(b);
  if (na.length < 4 || nb.length < 4) return 0; // too short to be a reliable id
  if (na === nb) return 1;
  return levRatio(na, nb);
}
