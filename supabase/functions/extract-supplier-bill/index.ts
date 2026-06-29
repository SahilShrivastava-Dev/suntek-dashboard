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
  'Read this supplier bill / tax invoice and return ONLY this JSON, filled from the image:\n' +
  '{"totalAmount": 0, "lineItemCount": 0, "currency": "INR"}\n' +
  'Rules:\n' +
  '- totalAmount = the FINAL grand total payable shown on the bill, INCLUDING GST ' +
  '(look for "Grand Total", "Total", "Net Payable", "Bill Amount", "Invoice Total"). ' +
  'Return it as a plain number with no commas or currency symbol (e.g. 32800000 for ₹3,28,00,000).\n' +
  '- lineItemCount = the number of distinct product/item ROWS in the items table ' +
  '(count each line item once; do NOT count header, tax, or total rows).\n' +
  '- currency = the currency code if visible, else "INR".\n' +
  '- If a value is unreadable, use null for that field.';

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
    const nvidiaRes = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'meta/llama-3.2-90b-vision-instruct',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: [
            { type: 'image_url', image_url: { url: image, detail: 'high' } },
            { type: 'text', text: BILL_PROMPT },
          ] },
        ],
        max_tokens: 512,
        temperature: 0.05,
      }),
    });

    if (!nvidiaRes.ok) {
      const t = await nvidiaRes.text().catch(() => '(no body)');
      return json({ error: `NVIDIA API ${nvidiaRes.status}: ${t.slice(0, 400)}` }, 502);
    }

    const nvidiaJson = await nvidiaRes.json();
    const content: string = nvidiaJson?.choices?.[0]?.message?.content ?? '';
    const first = content.indexOf('{');
    const last = content.lastIndexOf('}');
    if (first === -1 || last <= first) {
      return json({ totalAmount: null, lineItemCount: null, currency: null, raw: content.slice(0, 300) });
    }

    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(content.slice(first, last + 1)); } catch { /* fall through to nulls */ }

    return json({
      totalAmount: toNum(parsed.totalAmount),
      lineItemCount: toNum(parsed.lineItemCount),
      currency: typeof parsed.currency === 'string' ? parsed.currency : 'INR',
      raw: content.slice(0, 600),
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
