// Shared types for the anomaly detection dashboard.
// Mirrors the server AnomalyFinding shape returned by /api/anomaly/scan.

export type Severity = 'urgent' | 'warning' | 'info';
export type AnomalyLayer = 'rule' | 'stat' | 'ml' | 'llm';
export type Level = 'mild' | 'moderate' | 'heavy' | 'extreme';
export type Grain = 'daily' | 'weekly' | 'monthly';

export interface AnomalyFinding {
  id: string;
  anomaly_type: string;
  tier: 1 | 2 | 3;
  layer: AnomalyLayer;
  severity: Severity;
  level: Level;
  entity_id?: string;
  entity_type?: string;
  kpi_key?: string;
  score: number;          // 0..1
  metric_value: number | null;
  baseline_value: number | null;
  detail: Record<string, any>;
  title: string;
  body: string;
  route: string;
  fired_at: string;
}

export interface AnomalyKpi {
  key: string;
  label: string;
  value: string;
  raw: number;
  trend: number | null;
  baseline: number | null;
  fmt: 'pct' | 'inr';
  problem: boolean;
}

export interface ScanResult {
  generated_at: string;
  anchor_date: string;
  summary: { urgent: number; warning: number; info: number; total: number; levels: Record<Level, number> };
  kpis: AnomalyKpi[];
  findings: AnomalyFinding[];
  _fallback?: true;
}

export interface MetricMeta {
  key: string;
  label: string;
  unit: 'inr' | 'pct' | 'num';
  direction: 'up_bad' | 'down_bad';
  desc: string;
}

export interface MetricsCatalog {
  grains: Grain[];
  metrics: MetricMeta[];
}

export interface SeriesPoint {
  period: string;
  label: string;
  value: number;
  baseline: number | null;
  ewma: number | null;
  upper: number | null;
  lower: number | null;
  iqrUpper?: number | null;
  iqrLower?: number | null;
  z: number;
  robustZ: number;
  score: number;
  severity: Level | 'normal';
  isAnomaly: boolean;
  warming: boolean;
}

export interface TimeSeriesResult {
  metric: string;
  grain: Grain;
  meta: { label: string; unit: 'inr' | 'pct' | 'num'; direction: string; desc: string };
  summary: { points: number; anomalies: number; byLevel: Record<Level, number>; latest: SeriesPoint | null };
  points: SeriesPoint[];
  _fallback?: true;
}

export interface AnalyticsResult {
  generated_at: string;
  anchor_date: string;
  margin: { fyPct: number; recentPct: number; priorPct: number; weekly: { label: string; value: number }[] };
  salesPurchase: { label: string; sales: number; purchase: number }[];
  cashflow: { label: string; receipts: number; payments: number; net: number }[];
  radar: { key: string; label: string; unit: 'inr' | 'pct' | 'num'; value: number; z: number; severity: Level | 'normal' }[];
  timeline: { key: string; label: string; mild: number; moderate: number; heavy: number; extreme: number; total: number }[];
  vendors: { name: string; sharePct: number; spend: number }[];
  debtors: { name: string; outstanding: number }[];
  _fallback?: true;
}

export interface Narrative {
  narrative: string;
  hypotheses: string[];
  recommended_action: string;
  confidence: 'low' | 'medium' | 'high';
  source: string;
}
