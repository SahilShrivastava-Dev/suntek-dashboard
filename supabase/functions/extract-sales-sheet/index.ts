/**
 * Supabase Edge Function: extract-sales-sheet
 *
 * Server-side proxy for the NVIDIA Llama 3.2 Vision 90B API.
 * Extracts structured data from sales delivery challan / DC photos.
 *
 * POST  { image: "data:image/jpeg;base64,..." }
 * → 200 { dcNumber, date, customerName, lineItems[], totalAmount, ... }
 *
 * Deploy:
 *   supabase functions deploy extract-sales-sheet --no-verify-jwt
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

Carefully read and extract ALL data from this sales delivery challan (DC) image.
Return ONLY a valid JSON object — no markdown fences, no explanation, just raw JSON.

Extract the following fields:
- dcNumber: the DC / challan / invoice number (string)
- date: date in DD/MM/YYYY format (string or null)
- customerName: name of the customer / buyer (string or null)
- customerAddress: full delivery address (string or null)
- vehicleNumber: truck / vehicle registration number (string or null)
- driverName: driver name if visible (string or null)
- lineItems: array of items, each with:
    slNo (string or null), description (product name/grade, string or null),
    density (specific gravity, string or null), quantity (number or null),
    unit (e.g. "Drums", "KG", string or null), ratePerUnit (number or null),
    amount (number or null)
- totalAmount: grand total amount (number or null)
- totalDrums: total number of drums dispatched (number or null)
- remarks: any notes, instructions, or extra text on the document (string, empty if none)

Return this EXACT JSON structure:
{
  "dcNumber": "string",
  "date": "DD/MM/YYYY or null",
  "customerName": "string or null",
  "customerAddress": "string or null",
  "vehicleNumber": "string or null",
  "driverName": "string or null",
  "lineItems": [
    {
      "slNo": "string or null",
      "description": "string or null",
      "density": "string or null",
      "quantity": number_or_null,
      "unit": "string or null",
      "ratePerUnit": number_or_null,
      "amount": number_or_null
    }
  ],
  "totalAmount": number_or_null,
  "totalDrums": number_or_null,
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
    console.log('[extract-sales-sheet] Request received at', new Date().toISOString());
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

    console.log('[extract-sales-sheet] Raw content length:', content.length);

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
      console.log('[extract-sales-sheet] Parsed OK, DC:', (extracted as any)?.dcNumber);
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
