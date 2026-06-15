/**
 * Writes engineered feature tables to suntek-dashboard/data/anomaly/ as CSV, so the
 * feature engineering is transparent and inspectable (open in Excel / pandas). One file
 * per metric × grain, plus a manifest. This is the "save the data here" deliverable.
 */
import { writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { METRICS, GRAINS, metricSeries } from './features.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', '..', 'data', 'anomaly');

const CSV_COLS = ['period', 'label', 'value', 'baseline', 'ewma', 'upper', 'lower', 'iqrUpper', 'iqrLower', 'z', 'robustZ', 'score', 'severity', 'isAnomaly', 'warming'];

function toCsv(points) {
  const head = CSV_COLS.join(',');
  const rows = points.map(p => CSV_COLS.map(c => {
    let v = p[c];
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return Number.isInteger(v) ? v : v.toFixed(4);
    if (typeof v === 'string' && v.includes(',')) return `"${v}"`;
    return v;
  }).join(','));
  return [head, ...rows].join('\n');
}

export async function exportAllFeatures(anchor) {
  mkdirSync(DATA_DIR, { recursive: true });
  const manifest = [];
  for (const metric of Object.keys(METRICS)) {
    for (const grain of GRAINS) {
      const series = await metricSeries(metric, grain, anchor);
      const fname = `${metric}_${grain}.csv`;
      writeFileSync(join(DATA_DIR, fname), toCsv(series.points));
      manifest.push({
        file: `data/anomaly/${fname}`,
        metric, grain,
        rows: series.points.length,
        anomalies: series.summary.anomalies,
        byLevel: series.summary.byLevel,
      });
    }
  }
  writeFileSync(join(DATA_DIR, '_manifest.json'), JSON.stringify({ generated_at: new Date().toISOString(), anchor, files: manifest }, null, 2));
  return { dir: 'data/anomaly', count: manifest.length, files: manifest };
}
