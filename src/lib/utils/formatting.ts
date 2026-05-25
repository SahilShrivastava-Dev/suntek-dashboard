/**
 * Formatting utilities for the Suntek ERP Dashboard.
 */

/** Format Indian Rupee amounts (₹ 1,23,456) */
export function formatINR(amount: number, short = false): string {
  if (short) {
    if (amount >= 1_00_00_000) return `₹ ${(amount / 1_00_00_000).toFixed(2)} Cr`;
    if (amount >= 1_00_000) return `₹ ${(amount / 1_00_000).toFixed(2)} L`;
    if (amount >= 1_000) return `₹ ${(amount / 1_000).toFixed(1)} K`;
    return `₹ ${amount.toLocaleString('en-IN')}`;
  }
  return `₹ ${amount.toLocaleString('en-IN')}`;
}

/** Format metric tons */
export function formatMT(qty: number): string {
  return `${qty.toLocaleString('en-IN', { maximumFractionDigits: 1 })} MT`;
}

/** Format drums count */
export function formatDrums(count: number): string {
  return `${count.toLocaleString('en-IN')} drums`;
}

/** Format percentage */
export function formatPct(value: number, decimals = 1): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(decimals)}%`;
}

/** Format a date string for display */
export function formatDate(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Format datetime for logs */
export function formatDateTime(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleString('en-IN', {
    day: '2-digit', month: 'short',
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

/** Get relative time (e.g. "2h ago") */
export function relativeTime(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

/** Clamp a number between min and max */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Convert density to a display label */
export function densityLabel(density: number): string {
  return density.toLocaleString('en-IN');
}
