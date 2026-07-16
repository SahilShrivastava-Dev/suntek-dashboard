/**
 * Supabase Edge Function: extract-supplier-bill
 *
 * Reads a supplier purchase bill / invoice photo and returns just the two figures
 * the Purchase Manager declares, so the app can cross-check them:
 *   - totalAmount    : the grand total payable (INCLUDING GST) — the bottom line.
 *   - lineItemCount  : how many distinct product/line rows the bill has.
 *
 * This is intentionally a "small" OCR — we don't itemise unit prices (GST makes
 * that unreliable). A mismatch is advisory only; the app flags + escalates but
 * never blocks (the model can be wrong).
 *
 * POST  { image: "data:image/jpeg;base64,..." }
 * → 200  { totalAmount: number|null, lineItemCount: number|null, currency: string|null, raw: string }
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { nvidiaChat } from '../_shared/nvidiaVision.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SYSTEM_PROMPT =
  'You are a JSON-only OCR API for Indian supplier invoices. ' +
  'Your entire response MUST be a single valid JSON object. ' +
  'No prose, no markdown, no code fences. Start with { and end with }.';

const BILL_PROMPT =
  'Read this Indian supplier tax invoice and return ONLY this JSON, filled from the image:\n' +
  '{"subTotal": 0, "taxAmount": 0, "totalAmount": 0, "grandTotalQty": 0, "lineItemCount": 0, "currency": "INR", ' +
  '"lineItems": [{"description": "", "quantity": 0, "unit": "", "unitPrice": 0, "amount": 0}]}\n' +
  'All amounts are plain numbers — no commas, no currency symbol.\n' +
  '- subTotal = the taxable value BEFORE GST (labelled "Taxable Amt", "Total before tax", "Sub Total").\n' +
  '- taxAmount = the TOTAL GST = CGST + SGST + IGST (labelled "Total Tax", "Tax Amount"). ' +
  'This is a SMALL number; it is NOT the invoice total.\n' +
  '- totalAmount = the FINAL grand total payable INCLUDING GST (labelled "Grand Total", "Total Amount", ' +
  '"Net Payable", "Invoice Total"). It equals subTotal + taxAmount and is the LARGEST amount on the bill. ' +
  'NEVER put the tax value or a subtotal here (e.g. for a bill with subTotal 169463.34 and tax 8473.16, ' +
  'totalAmount is 177936.50, NOT 8473.16).\n' +
  '- grandTotalQty = the total quantity across all rows (the number in the Grand Total quantity cell, ' +
  'e.g. 466 for "466.000 Box").\n' +
  '- lineItemCount = number of distinct product rows (exclude header/tax/subtotal/total rows).\n' +
  '- lineItems = one object per product row, in order: description (product name exactly as printed), ' +
  'quantity, unit (Box/Kg/Pcs/…), unitPrice (per-unit rate / list price), amount (that row line total ' +
  'before tax, usually quantity × unitPrice).\n' +
  '- currency = code if visible else "INR".\n' +
  'Use null for any single value you cannot read. Return raw JSON only.';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function toNum(v: unknown): number | null {
  if (typeof v === 'number' && isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(/[^0-9.]/g, ''));
    return isFinite(n) ? n : null;
  }
  return null;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const body = await req.json().catch(() => null);
    const image: string | undefined = body?.image;
    if (!image) return json({ error: 'Missing "image" field' }, 400);

    const apiKey = Deno.env.get('NVIDIA_API_KEY');
    if (!apiKey) return json({ error: 'NVIDIA_API_KEY not set. Run: supabase secrets set NVIDIA_API_KEY=nvapi-...' }, 500);

    // 90B reads printed invoice amounts more reliably; a bill is a small doc so
    // it stays well within the Edge Function timeout.
    let content: string;
    try {
      const r = await nvidiaChat({
        apiKey,
        fallbackModel: 'meta/llama-3.2-90b-vision-instruct',
        maxTokens: 2048,
        jsonMode: true,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: [
            { type: 'image_url', image_url: { url: image, detail: 'high' } },
            { type: 'text', text: BILL_PROMPT },
          ] },
        ],
      });
      content = r.content;
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 502);
    }
    const first = content.indexOf('{');
    const last = content.lastIndexOf('}');
    if (first === -1 || last <= first) {
      return json({ totalAmount: null, subTotal: null, taxAmount: null, grandTotalQty: null, lineItemCount: null, currency: null, lineItems: [], raw: content.slice(0, 300) });
    }

    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(content.slice(first, last + 1)); } catch { /* fall through to nulls */ }

    const toArr = (v: unknown) => (Array.isArray(v) ? v : []);
    return json({
      totalAmount: toNum(parsed.totalAmount),
      subTotal: toNum(parsed.subTotal),
      taxAmount: toNum(parsed.taxAmount),
      grandTotalQty: toNum(parsed.grandTotalQty),
      lineItemCount: toNum(parsed.lineItemCount),
      currency: typeof parsed.currency === 'string' ? parsed.currency : 'INR',
      lineItems: toArr(parsed.lineItems).map((it: Record<string, unknown>) => ({
        description: typeof it?.description === 'string' ? it.description : '',
        quantity: toNum(it?.quantity),
        unit: typeof it?.unit === 'string' ? it.unit : null,
        unitPrice: toNum(it?.unitPrice),
        amount: toNum(it?.amount),
      })),
      raw: content.slice(0, 600),
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
