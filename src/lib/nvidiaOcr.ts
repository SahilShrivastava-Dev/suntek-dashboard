/**
 * NVIDIA Llama 3.2 Vision 90B — Batch Sheet OCR client
 *
 * Usage:
 *   Add VITE_NVIDIA_API_KEY=<your-key> to .env.local
 *   Get a key at: https://build.nvidia.com → Login → Generate API Key
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface BatchReadingExtracted {
  date: string;
  time: string;
  temp: number | null;
  cpGravity: number | null;
  cl2Pressure: string | null;       // raw string, e.g. "800g", "1.1", "2kg"
  cl2PipeLinePressure: string | null;
  hclGravity: number | null;
  operator: string | null;
}

export interface ExtractedBatchSheet {
  batchNo: string;
  /** Printed company/firm name in the sheet header (used for blacklist screening). */
  companyName?: string | null;
  finalGravity: number | null;
  readings: BatchReadingExtracted[];
  processInfo: {
    oilTime: string | null;
    oilDate: string | null;
    oilTemp: number | null;
    cl2StartingTime: string | null;
    cl2StartingTemp: number | null;
    frrTime: string | null;
    frrTemp: number | null;
    totalBatchTime: string | null;
    pressure: string | null;
  };
  summary: {
    typeOfOil: string | null;
    melterNo: string | null;
    degasserNo: string | null;
    openingBalance: number | null;
    totalDrumsFilled: number | null;
    closingBalance: number | null;
    helper: string | null;
    operator: string | null;
    paraffinWeight: number | null;
    hclQuantity: number | null;
    reactorAirPurgingTemp: number | null;
    reactorAirPurgingStartTime: string | null;
    reactorAirPurgingEndTime: string | null;
  };
  notes: string;
}

// ── Prompt ───────────────────────────────────────────────────────────────────

const EXTRACTION_PROMPT = `You are a precise OCR assistant for a CP (Chlorinated Paraffin) manufacturing plant in India.

Carefully read and extract ALL handwritten data from this batch log sheet image.
Return ONLY a valid JSON object — no markdown fences, no explanation, just JSON.

SHEET SECTIONS:
1. HEADER: "BATCH NO." value (just the number, e.g. "1228") and "FINAL GRAVITY" value (number, e.g. 1390)

2. MAIN TABLE — extract every row that has any data written. Columns:
   - DATE: format DD/MM/YY (e.g. "22/02/26")
   - TIME: e.g. "10 PM", "2 AM", "6 AM", "10 AM", "2 PM", "6 PM"
   - TEMP: integer °C (e.g. 101, 102, 104...)
   - CP GRAVITY: integer (e.g. 910, 960, 1070...)
   - Cl2 pressure: string preserving units, e.g. "800g", "900g", "1kg", "1.1", "1Kg", "1kg"
   - Cl2 Pipe Line Pressure: string, usually "2kg" or "2Kg" or similar
   - HCL GRAVITY: integer or null. "f" or "t" means full/same — use null
   - OPERATOR: handwritten name

3. PROCESS INFO (below the main table):
   OIL TIME, DATE, TEMP, Cl2 Starting Time, TEMP, FRR TIME, TEMP, TOTAL BATCH TIME, PRESSURE

4. BOTTOM SUMMARY (two-column layout):
   Left: TYPE OF OIL, Reactor Air Purging (Temp/Start Time/End Time), Cooling stop temp,
         Degasser Air Purging Time (Start/End), Paraffin Weight, HS Used, Filling In-charge, HCL Quantity
   Right: Melter No./Temp, Degasser No., Opening Balance, Total Drums Filled, Closing Balance,
          Brightener, Helper, Operator, Free Cl2, OIL CON RATIO/Kg CP, Sp. Gravity/temp, Technical

Return this EXACT JSON (no extra keys, all values exactly typed as shown):
{
  "batchNo": "string",
  "finalGravity": number_or_null,
  "readings": [
    {
      "date": "DD/MM/YY",
      "time": "H AM/PM",
      "temp": number_or_null,
      "cpGravity": number_or_null,
      "cl2Pressure": "string_or_null",
      "cl2PipeLinePressure": "string_or_null",
      "hclGravity": number_or_null,
      "operator": "string_or_null"
    }
  ],
  "processInfo": {
    "oilTime": "string_or_null",
    "oilDate": "string_or_null",
    "oilTemp": number_or_null,
    "cl2StartingTime": "string_or_null",
    "cl2StartingTemp": number_or_null,
    "frrTime": "string_or_null",
    "frrTemp": number_or_null,
    "totalBatchTime": "string_or_null",
    "pressure": "string_or_null"
  },
  "summary": {
    "typeOfOil": "string_or_null",
    "melterNo": "string_or_null",
    "degasserNo": "string_or_null",
    "openingBalance": number_or_null,
    "totalDrumsFilled": number_or_null,
    "closingBalance": number_or_null,
    "helper": "string_or_null",
    "operator": "string_or_null",
    "paraffinWeight": number_or_null,
    "hclQuantity": number_or_null,
    "reactorAirPurgingTemp": number_or_null,
    "reactorAirPurgingStartTime": "string_or_null",
    "reactorAirPurgingEndTime": "string_or_null"
  },
  "notes": "any NOTE text from the sheet, or empty string"
}`;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Resize an image File to max 1600px on its longest side, then return
 * a JPEG data URL (base64) suitable for the NVIDIA vision API.
 */
export async function resizeImageToDataUrl(file: File, maxPx = 1600): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      const { naturalWidth: w, naturalHeight: h } = img;
      const scale = Math.min(1, maxPx / Math.max(w, h));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('Canvas 2D context unavailable')); return; }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(objectUrl);
      resolve(canvas.toDataURL('image/jpeg', 0.88));
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to load image'));
    };
    img.src = objectUrl;
  });
}

/**
 * Parse a Cl2 pressure string like "800g", "1.1", "2kg", "1 kg" → float in kg.
 * Returns null if unparseable.
 */
export function parsePressureToKg(raw: string | null): number | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  const match = s.match(/([\d.]+)\s*(g|kg|k)?/i);
  if (!match) return null;
  const val = parseFloat(match[1]);
  const unit = (match[2] || 'kg').toLowerCase();
  if (unit === 'g') return val / 1000;
  return val;
}

/**
 * Parse a batch date "DD/MM/YY" + time "H AM/PM" into an ISO timestamp string.
 * Falls back to now() if parsing fails.
 */
export function parseBatchTimestamp(date: string, time: string): string {
  try {
    // date: "22/02/26" → 2026-02-22
    const [d, m, y] = date.split('/').map(Number);
    const year = y < 100 ? 2000 + y : y;

    // time: "10 PM", "2 AM", "6:30 AM" etc
    const timeUpper = time.toUpperCase().trim();
    let hour = 0;
    let minute = 0;
    const timeParts = timeUpper.match(/(\d+)(?::(\d+))?\s*(AM|PM)/);
    if (timeParts) {
      hour = parseInt(timeParts[1]);
      minute = timeParts[2] ? parseInt(timeParts[2]) : 0;
      const ampm = timeParts[3];
      if (ampm === 'PM' && hour !== 12) hour += 12;
      if (ampm === 'AM' && hour === 12) hour = 0;
    }
    return new Date(year, m - 1, d, hour, minute, 0).toISOString();
  } catch {
    return new Date().toISOString();
  }
}

// ── Sales Sheet types ─────────────────────────────────────────────────────────

export interface SalesLineItem {
  slNo: string | null;
  description: string | null;
  density: string | null;
  quantity: number | null;
  unit: string | null;
  ratePerUnit: number | null;
  amount: number | null;
}

export interface ExtractedSalesSheet {
  dcNumber: string;
  date: string | null;
  customerName: string | null;
  customerAddress: string | null;
  vehicleNumber: string | null;
  driverName: string | null;
  lineItems: SalesLineItem[];
  totalAmount: number | null;
  totalDrums: number | null;
  remarks: string;
}

// ── Purchase Sheet types ──────────────────────────────────────────────────────

export interface PurchaseLineItem {
  slNo: string | null;
  description: string | null;
  quantity: number | null;
  unit: string | null;
  ratePerUnit: number | null;
  amount: number | null;
  hsnCode: string | null;
}

export interface ExtractedPurchaseSheet {
  invoiceNumber: string;
  invoiceDate: string | null;
  supplierName: string | null;
  supplierAddress: string | null;
  supplierGstin: string | null;
  buyerName: string | null;
  buyerGstin: string | null;
  destination: string | null;
  lineItems: PurchaseLineItem[];
  subTotal: number | null;
  taxAmount: number | null;
  totalAmount: number | null;
  paymentTerms: string | null;
  remarks: string;
}

// ── Daily Unit Log types ──────────────────────────────────────────────────────

export interface DailyLogReading {
  time: string;
  aux1Temp: number | null;
  aux2Temp: number | null;
  aux3Temp: number | null;
  hclPrimaryTemp: number | null;
  hclSecondaryTemp: number | null;
  pressureA: number | null;
  pressureB: number | null;
  pressureC: number | null;
  pressureD: number | null;
  hclDensity: number | null;
  cpwRfDensity: number | null;
  cpwR6Density: number | null;
  cpwTransferFrom: string | null;
  cpwTransferTo: string | null;
  blowerOn: string | null;
  blowerOff: string | null;
  flowMeterTop: number | null;
  flowMeterRa: number | null;
  flowMeterR1: number | null;
}

export interface DailyLogTankSummary {
  tankIndex: number;
  shiftingToStorageTime: string | null;
  density: number | null;
  heatStabilizerQty: string | null;
  brightenerQty: string | null;
}

export interface ExtractedDailyLog {
  date: string;
  shift: string;
  unitName: string;
  operatorNames: string[];
  helperName: string | null;
  readings: DailyLogReading[];
  tankSummaries: DailyLogTankSummary[];
  remarks: string;
  notes: {
    hnpTank: string | null;
    hclTank: string | null;
    other: string | null;
  };
}

// ── Main API call (via Supabase Edge Function proxy) ─────────────────────────
//
// Calling NVIDIA directly from the browser is blocked by CORS.
// The Edge Function at supabase/functions/extract-batch-sheet/ proxies the
// request server-side using the NVIDIA_API_KEY Supabase secret.
//
// Edge Function URL: <VITE_SUPABASE_URL>/functions/v1/extract-batch-sheet

/**
 * Extract batch sheet data from an image using NVIDIA Llama 3.2 Vision 90B,
 * routed through the Supabase Edge Function proxy to avoid CORS.
 *
 * @param imageDataUrl  A JPEG data URL (output of resizeImageToDataUrl)
 */
export async function extractBatchSheet(imageDataUrl: string): Promise<ExtractedBatchSheet> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl) {
    throw new Error('VITE_SUPABASE_URL is not set in .env.local');
  }

  const edgeFnUrl = `${supabaseUrl}/functions/v1/extract-batch-sheet`;

  let response: Response;
  try {
    response = await fetch(edgeFnUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Supabase Edge Functions accept the anon key for auth
        ...(supabaseAnonKey ? {
          Authorization: `Bearer ${supabaseAnonKey}`,
          apikey: supabaseAnonKey,
        } : {}),
      },
      body: JSON.stringify({ image: imageDataUrl }),
    });
  } catch (networkErr: any) {
    throw new Error(
      `Network error calling Edge Function at ${edgeFnUrl}.\n` +
      `Make sure the function is deployed: supabase functions deploy extract-batch-sheet --no-verify-jwt\n` +
      `Raw error: ${networkErr?.message ?? networkErr}`
    );
  }

  const json = await response.json().catch(() => ({})) as Record<string, unknown>;

  if (!response.ok) {
    const errMsg = (json as any)?.error ?? `HTTP ${response.status}`;
    throw new Error(`Edge Function error: ${errMsg}`);
  }

  // Edge Function already parsed and returned the structured data
  return json as unknown as ExtractedBatchSheet;
}

// ── Daily Unit Log extraction ─────────────────────────────────────────────────

/**
 * Extract a Unit Daily Monitoring Log (hourly temperature/pressure/density sheet)
 * via the extract-daily-log Edge Function.
 */
export async function extractDailyLog(imageDataUrl: string): Promise<ExtractedDailyLog> {
  const supabaseUrl    = import.meta.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl) throw new Error('VITE_SUPABASE_URL is not set in .env.local');

  const edgeFnUrl = `${supabaseUrl}/functions/v1/extract-daily-log`;
  let response: Response;
  try {
    response = await fetch(edgeFnUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(supabaseAnonKey ? {
          Authorization: `Bearer ${supabaseAnonKey}`,
          apikey: supabaseAnonKey,
        } : {}),
      },
      body: JSON.stringify({ image: imageDataUrl }),
    });
  } catch (e: any) {
    throw new Error(
      `Network error calling Edge Function.\n` +
      `Deploy with: supabase functions deploy extract-daily-log --no-verify-jwt\n` +
      `Raw error: ${e?.message ?? e}`
    );
  }

  const json = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(`Edge Function error: ${(json as any)?.error ?? `HTTP ${response.status}`}`);
  }
  return json as unknown as ExtractedDailyLog;
}

// ── Sales Sheet extraction ────────────────────────────────────────────────────

export async function extractSalesSheet(imageDataUrl: string): Promise<ExtractedSalesSheet> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl) throw new Error('VITE_SUPABASE_URL is not set in .env.local');

  const edgeFnUrl = `${supabaseUrl}/functions/v1/extract-sales-sheet`;
  let response: Response;
  try {
    response = await fetch(edgeFnUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(supabaseAnonKey ? {
          Authorization: `Bearer ${supabaseAnonKey}`,
          apikey: supabaseAnonKey,
        } : {}),
      },
      body: JSON.stringify({ image: imageDataUrl }),
    });
  } catch (e: any) {
    throw new Error(
      `Network error calling Edge Function.\n` +
      `Deploy with: supabase functions deploy extract-sales-sheet --no-verify-jwt\n` +
      `Raw error: ${e?.message ?? e}`
    );
  }

  const json = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(`Edge Function error: ${(json as any)?.error ?? `HTTP ${response.status}`}`);
  }
  return json as unknown as ExtractedSalesSheet;
}

// ── Purchase Sheet extraction ─────────────────────────────────────────────────

export async function extractPurchaseSheet(imageDataUrl: string): Promise<ExtractedPurchaseSheet> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl) throw new Error('VITE_SUPABASE_URL is not set in .env.local');

  const edgeFnUrl = `${supabaseUrl}/functions/v1/extract-purchase-sheet`;
  let response: Response;
  try {
    response = await fetch(edgeFnUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(supabaseAnonKey ? {
          Authorization: `Bearer ${supabaseAnonKey}`,
          apikey: supabaseAnonKey,
        } : {}),
      },
      body: JSON.stringify({ image: imageDataUrl }),
    });
  } catch (e: any) {
    throw new Error(
      `Network error calling Edge Function.\n` +
      `Deploy with: supabase functions deploy extract-purchase-sheet --no-verify-jwt\n` +
      `Raw error: ${e?.message ?? e}`
    );
  }

  const json = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(`Edge Function error: ${(json as any)?.error ?? `HTTP ${response.status}`}`);
  }
  return json as unknown as ExtractedPurchaseSheet;
}

// ── Supplier bill verification (Purchase Manager) ─────────────────────────────

export interface SupplierBillLine {
  description: string;
  quantity: number | null;
  unit: string | null;
  unitPrice: number | null;
  amount: number | null;
}
export interface ExtractedSupplierBill {
  totalAmount: number | null;
  /** Taxable value before GST — pair with taxAmount to compute a robust grand total. */
  subTotal?: number | null;
  taxAmount?: number | null;
  /** Total quantity across all line items (e.g. 466 Boxes). */
  grandTotalQty?: number | null;
  lineItemCount: number | null;
  currency: string | null;
  lineItems?: SupplierBillLine[];
  raw?: string;
}

/** OCR a supplier bill photo to read back its grand total + line-item count. */
export async function extractSupplierBill(imageDataUrl: string): Promise<ExtractedSupplierBill> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl) throw new Error('VITE_SUPABASE_URL is not set in .env.local');

  const edgeFnUrl = `${supabaseUrl}/functions/v1/extract-supplier-bill`;
  let response: Response;
  try {
    response = await fetch(edgeFnUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(supabaseAnonKey ? {
          Authorization: `Bearer ${supabaseAnonKey}`,
          apikey: supabaseAnonKey,
        } : {}),
      },
      body: JSON.stringify({ image: imageDataUrl }),
    });
  } catch (e: any) {
    throw new Error(
      `Network error calling Edge Function.\n` +
      `Deploy with: supabase functions deploy extract-supplier-bill --no-verify-jwt\n` +
      `Raw error: ${e?.message ?? e}`
    );
  }

  const json = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(`Edge Function error: ${(json as any)?.error ?? `HTTP ${response.status}`}`);
  }
  return json as unknown as ExtractedSupplierBill;
}
