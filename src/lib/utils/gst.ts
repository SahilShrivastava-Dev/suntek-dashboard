/**
 * GSTIN helpers — normalization + format validation for Indian GST numbers.
 *
 * Format (15 chars): 2-digit state code · 10-char PAN (5 letters, 4 digits,
 * 1 letter) · 1 entity code (1-9/A-Z) · literal 'Z' · 1 checksum (0-9/A-Z).
 * Validation is format-only (no checksum math) — bills are OCR'd and the goal
 * is catching obvious misreads, not rejecting rare legitimate edge cases.
 */

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** Uppercase + strip all whitespace. Empty input stays ''. */
export function normalizeGstin(raw: string | null | undefined): string {
  return (raw || '').replace(/\s+/g, '').toUpperCase();
}

/** Format check on the NORMALIZED value. Empty is not valid (use optional checks upstream). */
export function isValidGstin(raw: string | null | undefined): boolean {
  return GSTIN_RE.test(normalizeGstin(raw));
}
