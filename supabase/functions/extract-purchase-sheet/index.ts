/**
 * Supabase Edge Function: extract-purchase-sheet
 *
 * Server-side proxy for the NVIDIA Llama 3.2 Vision 90B API.
 * Extracts structured data from purchase invoice / challan photos.
 *
 * POST  { image: "data:image/jpeg;base64,..." }
 * → 200 { invoiceNumber, invoiceDate, supplierName, lineItems[], totalAmount, ... }
 *
 * Deploy:
 *   supabase functions deploy extract-purchase-sheet --no-verify-jwt
 * Secret:
 *   supabase secrets set NVIDIA_API_KEY=nvapi-...
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { nvidiaChat } from '../_shared/nvidiaVision.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const EXTRACTION_PROMPT = `You are a precise OCR assistant for a CP (Chlorinated Paraffin) manufacturing company in India.

Carefully read and extract ALL data from this purchase invoice or delivery challan image.
Return ONLY a valid JSON object. Do NOT use markdown, asterisks, bold, headings, or bullet
points anywhere. Your ENTIRE response must be a single JSON object that begins with { and ends
with } — nothing before or after it.

Extract the following fields:
- invoiceNumber: the invoice / bill / challan number (string)
- invoiceDate: date in DD/MM/YYYY format (string or null)
- supplierName: name of the supplier / seller company (string or null)
- supplierAddress: full address of the supplier (string or null)
- supplierGstin: supplier GSTIN number, 15-char alphanumeric (string or null)
- buyerName: name of the buyer / consignee (string or null)
- buyerGstin: buyer GSTIN (string or null)
- destination: delivery destination / place of supply (string or null)
- lineItems: array of items, each with:
    slNo (string or null), description (string or null), quantity (number or null),
    unit (string or null), ratePerUnit (number or null), amount (number or null),
    hsnCode (string or null)
    IMPORTANT column disambiguation (Indian invoices have many numeric columns):
    * ratePerUnit = the per-unit rate from the "List Price" / "Rate" / "Price/Per"
      column. It is a PRICE, never a percentage. Ignore "CGST Rate" / "SGST Rate"
      columns (those are % like 2.50% or 18%).
    * amount = the row's line total in the RIGHTMOST "Amount" column. It is the
      PRE-TAX value, normally quantity × ratePerUnit, and is the LARGEST number in
      that row. NEVER put a "CGST Amount", "SGST Amount", or "IGST" cell here —
      those are small tax figures (e.g. 904.76), not the line amount (e.g. 38000).
- subTotal: the taxable value BEFORE GST — labelled "Taxable Amt", "Total Before Tax",
  or "Sub Total". The sum of all line amounts equals this. (number or null)
- taxAmount: the TOTAL GST = CGST + SGST + IGST (labelled "Total Tax" / "Tax Amount").
  This is a SMALL number and is NOT the invoice total. (number or null)
- totalAmount: the FINAL grand total payable INCLUDING GST — labelled "Grand Total",
  "Total Amount", "Net Payable". It equals subTotal + taxAmount and is the LARGEST
  amount on the whole bill. Never put the tax value or a subtotal here. (number or null)
- paymentTerms: payment terms text if visible (string or null)
- remarks: any additional notes or remarks visible on the document (string, empty if none)

Return this EXACT JSON structure:
{
  "invoiceNumber": "string",
  "invoiceDate": "DD/MM/YYYY or null",
  "supplierName": "string or null",
  "supplierAddress": "string or null",
  "supplierGstin": "string or null",
  "buyerName": "string or null",
  "buyerGstin": "string or null",
  "destination": "string or null",
  "lineItems": [
    {
      "slNo": "string or null",
      "description": "string or null",
      "quantity": number_or_null,
      "unit": "string or null",
      "ratePerUnit": number_or_null,
      "amount": number_or_null,
      "hsnCode": "string or null"
    }
  ],
  "subTotal": number_or_null,
  "taxAmount": number_or_null,
  "totalAmount": number_or_null,
  "paymentTerms": "string or null",
  "remarks": "string"
}`;

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  try {
    console.log('[extract-purchase-sheet] Request received at', new Date().toISOString());
    const body = await req.json().catch(() => null);
    const image: string | undefined = body?.image;

    if (!image || typeof image !== 'string') {
      return new Response(
        JSON.stringify({ error: 'Request body must be JSON with an "image" field (data URL or base64).' }),
        { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } },
      );
    }

    const apiKey = Deno.env.get('NVIDIA_API_KEY');
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'NVIDIA_API_KEY secret is not set. Run: supabase secrets set NVIDIA_API_KEY=nvapi-...' }),
        { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } },
      );
    }

    let content: string;
    let usedModel: string;
    try {
      const r = await nvidiaChat({
        apiKey,
        fallbackModel: 'meta/llama-3.2-90b-vision-instruct',
        maxTokens: 4096,
        jsonMode: true,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: EXTRACTION_PROMPT },
              { type: 'image_url', image_url: { url: image, detail: 'high' } },
            ],
          },
        ],
      });
      content = r.content;
      usedModel = r.model;
    } catch (e) {
      return new Response(
        JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
        { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } },
      );
    }

    if (!content) {
      return new Response(
        JSON.stringify({ error: `NVIDIA API returned an empty response (model ${usedModel}).` }),
        { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } },
      );
    }

    console.log('[extract-purchase-sheet] Raw content length:', content.length);

    const firstBrace = content.indexOf('{');
    const lastBrace  = content.lastIndexOf('}');

    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      return new Response(
        JSON.stringify({ error: `AI response contained no JSON object. Preview: ${content.slice(0, 300)}` }),
        { status: 422, headers: { ...CORS, 'Content-Type': 'application/json' } },
      );
    }

    const jsonSlice = content.slice(firstBrace, lastBrace + 1);
    let extracted: unknown;
    try {
      extracted = JSON.parse(jsonSlice);
      console.log('[extract-purchase-sheet] Parsed OK, invoice:', (extracted as any)?.invoiceNumber);
    } catch (parseErr) {
      return new Response(
        JSON.stringify({ error: `JSON parse failed. Preview: ${jsonSlice.slice(0, 300)}` }),
        { status: 422, headers: { ...CORS, 'Content-Type': 'application/json' } },
      );
    }

    return new Response(JSON.stringify(extracted), {
      status: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
