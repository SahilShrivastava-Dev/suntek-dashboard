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

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const EXTRACTION_PROMPT = `You are a precise OCR assistant for a CP (Chlorinated Paraffin) manufacturing company in India.

Carefully read and extract ALL data from this purchase invoice or delivery challan image.
Return ONLY a valid JSON object — no markdown fences, no explanation, just raw JSON.

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
- subTotal: subtotal before tax (number or null)
- taxAmount: total GST / tax amount (number or null)
- totalAmount: grand total payable (number or null)
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

    const nvidiaRes = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'meta/llama-3.2-90b-vision-instruct',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: EXTRACTION_PROMPT },
              { type: 'image_url', image_url: { url: image, detail: 'high' } },
            ],
          },
        ],
        max_tokens: 2048,
        temperature: 0.05,
      }),
    });

    if (!nvidiaRes.ok) {
      const errText = await nvidiaRes.text().catch(() => '');
      return new Response(
        JSON.stringify({ error: `NVIDIA API returned ${nvidiaRes.status}: ${errText.slice(0, 400)}` }),
        { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } },
      );
    }

    const nvidiaJson = await nvidiaRes.json();
    const content: string = nvidiaJson?.choices?.[0]?.message?.content ?? '';

    if (!content) {
      return new Response(
        JSON.stringify({ error: 'NVIDIA API returned an empty response.' }),
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
