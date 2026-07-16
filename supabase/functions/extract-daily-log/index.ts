/**
 * Supabase Edge Function: extract-daily-log
 *
 * Tailored prompt for Unit Daily Monitoring Logs (multi-column hourly sheets
 * used at Madan Chemicals / Suntek units — temperature, pressure, density,
 * CPW transfer, blower, flow meter per hour).
 *
 * POST  { image: "data:image/jpeg;base64,..." }
 * → 200  ExtractedDailyLog JSON
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { nvidiaChat } from '../_shared/nvidiaVision.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// System message — forces the 11B model to output ONLY JSON (no prose)
const SYSTEM_PROMPT =
  'You are a JSON-only OCR API. ' +
  'Your entire response MUST be a single valid JSON object. ' +
  'Do NOT write any prose, explanation, markdown, or code fences. ' +
  'Start your response with { and end it with }.';

const DAILY_LOG_PROMPT =
  'Fill in the JSON template below using the data in this Unit Daily Monitoring Log image. ' +
  'Replace every placeholder with the actual value you read. Use null for blank or crossed-out cells. ' +
  'Include one object per hourly row in "readings". ' +
  'Transcribe "remarks" exactly as written (Hindi text is fine). ' +
  '\n\n' +
  '{"date":"DD/MM/YY","shift":"Morning","unitName":"string","operatorNames":["name1"],"helperName":null,' +
  '"readings":[' +
  '{"time":"8:00 AM","aux1Temp":0,"aux2Temp":0,"aux3Temp":0,"hclPrimaryTemp":0,"hclSecondaryTemp":0,' +
  '"pressureA":0,"pressureB":0,"pressureC":0,"pressureD":0,' +
  '"hclDensity":0,"cpwRfDensity":0,"cpwR6Density":null,' +
  '"cpwTransferFrom":null,"cpwTransferTo":null,"blowerOn":null,"blowerOff":null,' +
  '"flowMeterTop":null,"flowMeterRa":null,"flowMeterR1":null}' +
  '],' +
  '"tankSummaries":[' +
  '{"tankIndex":1,"shiftingToStorageTime":null,"density":null,"heatStabilizerQty":null,"brightenerQty":null},' +
  '{"tankIndex":2,"shiftingToStorageTime":null,"density":null,"heatStabilizerQty":null,"brightenerQty":null},' +
  '{"tankIndex":3,"shiftingToStorageTime":null,"density":null,"heatStabilizerQty":null,"brightenerQty":null}' +
  '],' +
  '"remarks":"","notes":{"hnpTank":null,"hclTank":null,"other":null}}';

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  try {
    console.log('[extract-daily-log] Request at', new Date().toISOString());

    const body = await req.json().catch(() => null);
    const image: string | undefined = body?.image;
    if (!image) {
      return new Response(JSON.stringify({ error: 'Missing "image" field' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }
    console.log('[extract-daily-log] Image size (chars):', image.length);

    const apiKey = Deno.env.get('NVIDIA_API_KEY');
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'NVIDIA_API_KEY not set. Run: supabase secrets set NVIDIA_API_KEY=nvapi-...' }), {
        status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // Use 11B model for daily logs — the document has ~260 numerical cells which
    // causes the 90B model to exceed the 150s Edge Function timeout.
    // 11B is ~10× faster and fully accurate for structured numeric tables.
    // 11B by default — daily logs have ~260 numeric cells and the 90B model can
    // exceed the Edge Function timeout. Override globally with NVIDIA_OCR_MODEL.
    let content: string;
    try {
      const r = await nvidiaChat({
        apiKey,
        fallbackModel: 'meta/llama-3.2-11b-vision-instruct',
        maxTokens: 4096,
        messages: [
          // System message forces JSON-only output from the 11B model
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: image, detail: 'high' } },
              { type: 'text', text: DAILY_LOG_PROMPT },
            ],
          },
        ],
      });
      content = r.content;
    } catch (e) {
      console.error('[extract-daily-log] NVIDIA error:', e instanceof Error ? e.message : String(e));
      return new Response(
        JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
        { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } },
      );
    }
    console.log('[extract-daily-log] Content length:', content.length, '| Preview:', content.slice(0, 150));

    // Robust extraction: find outermost { ... }
    const first = content.indexOf('{');
    const last  = content.lastIndexOf('}');
    if (first === -1 || last <= first) {
      return new Response(JSON.stringify({ error: `No JSON object in response. Preview: ${content.slice(0, 300)}` }), {
        status: 422, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    let extracted: unknown;
    const jsonSlice = content.slice(first, last + 1);
    try {
      extracted = JSON.parse(jsonSlice);
      console.log('[extract-daily-log] Parsed OK — date:', (extracted as any)?.date, 'rows:', (extracted as any)?.readings?.length);
    } catch (primaryErr) {
      // JSON was truncated mid-stream (max_tokens hit). Attempt repair:
      // chop back to the last complete reading object, then close the arrays/object.
      console.warn('[extract-daily-log] Primary parse failed, attempting repair. Error:', String(primaryErr));
      try {
        // Find the last complete '}' that ends a readings row
        const lastCompleteRow = jsonSlice.lastIndexOf('},');
        if (lastCompleteRow === -1) throw new Error('Cannot find repair point');

        // Keep everything up to and including that }, then close readings + root
        const repaired =
          jsonSlice.slice(0, lastCompleteRow + 1) +
          '],"tankSummaries":[],"remarks":"(truncated)","notes":{"hnpTank":null,"hclTank":null,"other":null}}';

        extracted = JSON.parse(repaired);
        (extracted as any)._truncated = true; // flag for the client
        console.log('[extract-daily-log] Repair succeeded — rows recovered:', (extracted as any)?.readings?.length);
      } catch (repairErr) {
        return new Response(JSON.stringify({
          error: `JSON parse failed: ${String(primaryErr)} | Slice: ${jsonSlice.slice(0, 200)}`,
        }), { status: 422, headers: { ...CORS, 'Content-Type': 'application/json' } });
      }
    }

    return new Response(JSON.stringify(extracted), {
      status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[extract-daily-log] Unexpected error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
