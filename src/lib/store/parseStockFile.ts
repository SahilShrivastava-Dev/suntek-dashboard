/**
 * parseStockFile — turn a client "Store Keeping" workbook into a per-month,
 * per-item stock model.
 *
 * The workbook holds a `Sales <Month>` and a `Purchase <Month>` sheet for each
 * month. Header sits on ~row 2 (a junk title row above it). Columns:
 *   Sr No. · Items Name · Unit · Op Stock/Opening · [1…31 day columns] · Closing Stock
 *
 * Per item, per month (both sheets combined):
 *   opening   = Sales "Op Stock"  (cross-checked vs Purchase "Opening")
 *   purchased = Σ Purchase daily   (bought that month)
 *   used      = Σ Sales daily      (issued that month)
 *   closing   = opening + purchased − used   ← becomes next month's headstart
 *
 * Pure + framework-free so it can be unit-tested and reused.
 */
import * as XLSX from 'xlsx';
import { similarity } from '../blacklist/similarity';

export interface MonthItem {
  itemName: string;         // display name (prefers the Sales sheet spelling)
  key: string;              // normalized join key (Sales ↔ Purchase)
  unit: string;
  equipment: string;        // derived from the name prefix
  model: string | null;     // derived from the (…) in the name
  opening: number;          // Sales "Op Stock"
  purchaseOpening: number;  // Purchase "Opening" (for the intra-month check)
  purchased: number;        // Σ Purchase daily
  used: number;             // Σ Sales daily
  closing: number;          // opening + purchased − used
}

export interface MonthParse {
  periodKey: string;        // 'YYYY-MM'
  periodMonth: string;      // 'YYYY-MM-01' (date for the DB)
  label: string;            // 'Apr 2026'
  items: MonthItem[];
  hasSales: boolean;
  hasPurchase: boolean;
}

export interface StockParseResult {
  months: MonthParse[];     // ascending by period
  latest: MonthParse | null;
  sheetCount: number;
  totalItems: number;       // item count in the latest month
}

export type AnomalyType = 'carry_forward' | 'intra_month' | 'negative' | 'added' | 'removed';
export interface Anomaly {
  type: AnomalyType;
  item: string;
  detail: string;
  severity: 'high' | 'medium' | 'info';
  prev?: number;
  curr?: number;
  delta?: number;
  suggestion?: string;      // possible rename target
}

// ── Unit normalization ───────────────────────────────────────────────────────
const UNIT_MAP: Record<string, string> = {
  'pcs': 'Pcs', 'pcs.': 'Pcs', 'pc': 'Pcs', 'nos': 'Pcs', 'no': 'Pcs', 'no.': 'Pcs',
  'ltr': 'Ltr', 'ltr.': 'Ltr', 'litre': 'Ltr', 'l': 'Ltr',
  'kg': 'Kg', 'kgs': 'Kg', 'pair': 'Pair', 'set': 'Set', 'sets': 'Set',
  'roll': 'Roll', 'role': 'Roll', 'pkt': 'Pkt', 'packet': 'Pkt',
  'mtr': 'Mtr', 'meter': 'Mtr', 'm': 'Mtr', 'can': 'Can', 'bag': 'Bag', 'bottle': 'Bottle',
};
export function normalizeUnit(raw: unknown): string {
  const s = (raw == null ? '' : String(raw)).trim();
  if (!s) return 'Pcs';
  return UNIT_MAP[s.toLowerCase()] ?? s;
}

// ── Equipment/model from the item name, e.g. "Acid Pump (NZRP50) Sleeve" ─────
export function deriveEquipment(name: string): { equipment: string; model: string | null } {
  const m = name.match(/^\s*(.*?)\s*\(([^)]*)\)/);
  if (m) return { equipment: (m[1] || name).trim(), model: (m[2] || '').trim() || null };
  // No parens → take the leading words before a dash/number as the "equipment".
  const eq = name.split(/[-–—,]/)[0].trim();
  return { equipment: eq || name.trim(), model: null };
}

// ── Join key: fold spacing/punctuation so the two sheets line up ─────────────
function joinKey(name: string): string {
  return name.toLowerCase().replace(/\s+/g, ' ').replace(/[^a-z0-9 ]/g, '').trim();
}

function num(v: unknown): number {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(/[^0-9.\-]/g, ''));
    return isFinite(n) ? n : 0;
  }
  return 0;
}

// ── Sheet name → { kind, periodKey } ─────────────────────────────────────────
const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};
function parseSheetName(name: string): { kind: 'sales' | 'purchase'; key: string; month: number; year: number } | null {
  const s = name.trim().toLowerCase();
  const km = s.match(/^(sales|purchase)/);
  if (!km) return null;
  const kind = km[1] as 'sales' | 'purchase';
  const mm = s.match(/([a-z]+)\.?\s*'?(\d{2,4})/);
  if (!mm) return null;
  const month = MONTHS[mm[1]];
  if (!month) return null;
  let year = parseInt(mm[2], 10);
  if (year < 100) year += 2000;
  return { kind, key: `${year}-${String(month).padStart(2, '0')}`, month, year };
}
const MONTH_LABELS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ── Parse one sheet (array-of-arrays) into a name→{unit,opening,movement} map ─
interface SheetItem { name: string; unit: string; opening: number; movement: number; }
function parseSheet(ws: XLSX.WorkSheet): Map<string, SheetItem> {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null, blankrows: false });
  // Header = the first row containing an "Items Name" cell.
  const hi = rows.findIndex(r => Array.isArray(r) && r.some(c => typeof c === 'string' && /items?\s*name/i.test(c)));
  if (hi < 0) return new Map();
  const header = (rows[hi] as unknown[]).map(c => (c == null ? '' : String(c).trim()));
  const findCol = (re: RegExp) => header.findIndex(h => re.test(h));
  const itemIdx = findCol(/items?\s*name/i);
  const unitIdx = findCol(/^unit/i);
  const openIdx = findCol(/op.*stock|opening/i);
  const closeIdx = findCol(/closing/i);
  if (itemIdx < 0 || openIdx < 0) return new Map();
  // Day columns live strictly between Opening and Closing (fallback: numeric headers after Opening).
  const dayIdxs: number[] = [];
  for (let j = openIdx + 1; j < header.length; j++) {
    if (closeIdx >= 0 && j >= closeIdx) break;
    if (closeIdx < 0 && !/^\d{1,2}$/.test(header[j])) continue;
    dayIdxs.push(j);
  }

  const out = new Map<string, SheetItem>();
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i] as unknown[];
    if (!Array.isArray(r)) continue;
    const nameRaw = r[itemIdx];
    const name = nameRaw == null ? '' : String(nameRaw).trim();
    if (!name) continue;
    const key = joinKey(name);
    if (!key) continue;
    const movement = dayIdxs.reduce((s, j) => s + num(r[j]), 0);
    const item: SheetItem = {
      name,
      unit: unitIdx >= 0 ? String(r[unitIdx] ?? '').trim() : '',
      opening: num(r[openIdx]),
      movement,
    };
    // First occurrence wins (guards against duplicate rows in the sheet).
    if (!out.has(key)) out.set(key, item);
  }
  return out;
}

/** Parse a Store Keeping workbook into the per-month, per-item model. */
export async function parseStockFile(file: File): Promise<StockParseResult> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });

  // Group sheets into { periodKey → { sales?, purchase? } }.
  type Pair = { month: number; year: number; sales?: Map<string, SheetItem>; purchase?: Map<string, SheetItem> };
  const byPeriod = new Map<string, Pair>();
  let sheetCount = 0;
  for (const sheetName of wb.SheetNames) {
    const meta = parseSheetName(sheetName);
    if (!meta) continue;
    sheetCount++;
    const parsed = parseSheet(wb.Sheets[sheetName]);
    if (!parsed.size) continue;
    const p = byPeriod.get(meta.key) ?? { month: meta.month, year: meta.year };
    p[meta.kind] = parsed;
    byPeriod.set(meta.key, p);
  }

  const months: MonthParse[] = [...byPeriod.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, p]) => {
      const sales = p.sales ?? new Map<string, SheetItem>();
      const purchase = p.purchase ?? new Map<string, SheetItem>();
      const keys = new Set<string>([...sales.keys(), ...purchase.keys()]);
      const items: MonthItem[] = [];
      for (const k of keys) {
        const s = sales.get(k);
        const pu = purchase.get(k);
        const name = (s?.name || pu?.name || '').trim();
        if (!name) continue;
        const opening = s ? s.opening : (pu ? pu.opening : 0);
        const purchaseOpening = pu ? pu.opening : 0;
        const purchased = pu ? pu.movement : 0;
        const used = s ? s.movement : 0;
        const { equipment, model } = deriveEquipment(name);
        items.push({
          itemName: name, key: k,
          unit: normalizeUnit(s?.unit || pu?.unit),
          equipment, model,
          opening, purchaseOpening, purchased, used,
          closing: opening + purchased - used,
        });
      }
      items.sort((a, b) => a.itemName.localeCompare(b.itemName));
      return {
        periodKey: key,
        periodMonth: `${key}-01`,
        label: `${MONTH_LABELS[p.month]} ${p.year}`,
        items,
        hasSales: !!p.sales,
        hasPurchase: !!p.purchase,
      };
    });

  const latest = months.length ? months[months.length - 1] : null;
  return { months, latest, sheetCount, totalItems: latest ? latest.items.length : 0 };
}

/**
 * Compare two consecutive months and surface anomalies:
 *  - carry_forward: prev closing ≠ this opening (the "someone changed 32→12" case)
 *  - intra_month:   Sales opening ≠ Purchase opening (same item/month)
 *  - negative:      used > opening + purchased (impossible)
 *  - added/removed: item set changed (with fuzzy "possible rename" hint)
 */
export function reconcile(prev: MonthParse | null, curr: MonthParse): Anomaly[] {
  const out: Anomaly[] = [];
  const prevByKey = new Map((prev?.items ?? []).map(i => [i.key, i]));
  const currByKey = new Map(curr.items.map(i => [i.key, i]));

  for (const it of curr.items) {
    // Carry-forward drift vs previous month's computed closing.
    if (prev) {
      const p = prevByKey.get(it.key);
      if (p && p.closing !== it.opening) {
        const delta = it.opening - p.closing;
        out.push({
          type: 'carry_forward', item: it.itemName, severity: Math.abs(delta) > 5 ? 'high' : 'medium',
          prev: p.closing, curr: it.opening, delta,
          detail: `Last month closed at ${p.closing}, this month opens at ${it.opening} (${delta > 0 ? '+' : ''}${delta}).`,
        });
      }
    }
    // Intra-month: the two sheets disagree on the opening.
    if (it.purchaseOpening && it.opening !== it.purchaseOpening) {
      out.push({
        type: 'intra_month', item: it.itemName, severity: 'medium',
        prev: it.opening, curr: it.purchaseOpening,
        detail: `Sales opening ${it.opening} ≠ Purchase opening ${it.purchaseOpening}.`,
      });
    }
    // Negative computed stock.
    if (it.closing < 0) {
      out.push({
        type: 'negative', item: it.itemName, severity: 'high', curr: it.closing,
        detail: `Used ${it.used} > available ${it.opening + it.purchased} → closing ${it.closing}.`,
      });
    }
  }

  if (prev) {
    const removed = prev.items.filter(i => !currByKey.has(i.key));
    const added = curr.items.filter(i => !prevByKey.has(i.key));
    for (const a of added) {
      // Fuzzy: was this a rename of something that disappeared?
      let best: { name: string; score: number } | null = null;
      for (const r of removed) {
        const sc = similarity(a.itemName, r.itemName);
        if (sc > 0.8 && (!best || sc > best.score)) best = { name: r.itemName, score: sc };
      }
      out.push({
        type: 'added', item: a.itemName, severity: 'info',
        detail: best ? `New item — possibly renamed from "${best.name}".` : 'New item this month.',
        suggestion: best?.name,
      });
    }
    for (const r of removed) {
      const wasRenamed = added.some(a => similarity(a.itemName, r.itemName) > 0.8);
      if (wasRenamed) continue; // already surfaced as a rename on the "added" side
      out.push({ type: 'removed', item: r.itemName, severity: 'info', detail: 'Item dropped from this month.' });
    }
  }

  return out;
}
