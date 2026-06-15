import type { Level } from './types';

// Severity tier palette: mild → extreme
export const LEVEL_COLOR: Record<Level | 'normal', string> = {
  mild: '#2563EB',
  moderate: '#D97706',
  heavy: '#EA580C',
  extreme: '#DC2626',
  normal: '#94A3B8',
};
export const LEVEL_BG: Record<Level | 'normal', string> = {
  mild: '#EFF6FF',
  moderate: '#FFFBEB',
  heavy: '#FFF7ED',
  extreme: '#FEF2F2',
  normal: '#F8FAFC',
};
export const LEVEL_ORDER: Level[] = ['extreme', 'heavy', 'moderate', 'mild'];
export const LEVEL_LABEL: Record<Level, string> = {
  mild: 'Mild', moderate: 'Moderate', heavy: 'Heavy', extreme: 'Extreme',
};

export function fmtValue(v: number | null | undefined, unit: 'inr' | 'pct' | 'num'): string {
  if (v == null || isNaN(v)) return '—';
  if (unit === 'pct') return `${(v * 100).toFixed(1)}%`;
  if (unit === 'num') return Math.round(v).toLocaleString('en-IN');
  // inr
  if (Math.abs(v) >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`;
  if (Math.abs(v) >= 1e5) return `₹${(v / 1e5).toFixed(1)} L`;
  if (Math.abs(v) >= 1e3) return `₹${(v / 1e3).toFixed(0)}K`;
  return `₹${Math.round(v).toLocaleString('en-IN')}`;
}
