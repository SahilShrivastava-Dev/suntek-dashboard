import { useQuery, useMutation } from '@tanstack/react-query';
import type { ScanResult, AnomalyFinding, Narrative, MetricsCatalog, TimeSeriesResult, Grain, AnalyticsResult } from './types';

// Same base + fetch convention as hooks/useBusyData.ts
const BUSY_BASE = import.meta.env.VITE_BUSY_API_URL ?? '';

async function fetchBusy<T>(path: string): Promise<T> {
  const res = await fetch(`${BUSY_BASE}${path}`, {
    headers: { 'ngrok-skip-browser-warning': '1' },
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data as T;
}

/** Full anomaly scan over real BUSY data — findings + problem-KPI snapshot. */
export function useAnomalyScan() {
  return useQuery<ScanResult>({
    queryKey: ['anomaly-scan'],
    queryFn: () => fetchBusy('/api/anomaly/scan'),
    staleTime: 60 * 1000,        // 1 min
    refetchInterval: 2 * 60 * 1000, // re-scan every 2 min (minute-to-minute feel)
  });
}

/** Analytics bundle for the multi-plot grid. */
export function useAnalytics() {
  return useQuery<AnalyticsResult>({
    queryKey: ['anomaly-analytics'],
    queryFn: () => fetchBusy('/api/anomaly/analytics'),
    staleTime: 60 * 1000,
    refetchInterval: 2 * 60 * 1000,
  });
}

/** Metric + grain catalog for the explorer controls. */
export function useMetricsCatalog() {
  return useQuery<MetricsCatalog>({
    queryKey: ['anomaly-metrics-catalog'],
    queryFn: () => fetchBusy('/api/anomaly/metrics'),
    staleTime: Infinity,
  });
}

/** Engineered time series for one metric at a chosen granularity. */
export function useMetricSeries(metric: string, grain: Grain) {
  return useQuery<TimeSeriesResult>({
    queryKey: ['anomaly-timeseries', metric, grain],
    queryFn: () => fetchBusy(`/api/anomaly/timeseries?metric=${metric}&grain=${grain}`),
    staleTime: 60 * 1000,
    placeholderData: (prev) => prev, // keep prior chart while switching grain
  });
}

/** Trigger a server-side CSV export of all engineered features. */
export function useExportFeatures() {
  return useMutation<{ dir: string; count: number; files: any[] }, Error, void>({
    mutationFn: async () => {
      const res = await fetch(`${BUSY_BASE}/api/anomaly/export`, { headers: { 'ngrok-skip-browser-warning': '1' } });
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      return res.json();
    },
  });
}

/** Lazily fetch an AI root-cause narrative for one finding. */
export function useNarrative() {
  return useMutation<Narrative, Error, AnomalyFinding>({
    mutationFn: async (finding) => {
      const res = await fetch(`${BUSY_BASE}/api/anomaly/narrative`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': '1' },
        body: JSON.stringify({ finding }),
      });
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      return res.json();
    },
  });
}
