/**
 * Shared NVIDIA vision call for the extract-* edge functions.
 *
 * Why this exists: every extractor duplicated the same fetch-to-NVIDIA block with a
 * hardcoded model string. When a model is retired/rate-limited the call fails and the
 * UI only ever saw a generic "could not be read". This centralises:
 *   - an ENV-OVERRIDABLE model (set NVIDIA_OCR_MODEL to rotate without a code change),
 *   - one retry on transient 5xx / network errors (429/5xx/timeouts are the common
 *     intermittent failure), and
 *   - a real, model-tagged error string so the true cause surfaces.
 *
 * Each function keeps its own prompt/messages + JSON parsing — only the transport is shared.
 */

declare const Deno: { env: { get(k: string): string | undefined } };

/** Model to use. A global NVIDIA_OCR_MODEL secret overrides the per-call fallback,
 *  so all extractors can be repointed at once at deploy time. */
export function ocrModel(fallback: string): string {
  const override = Deno.env.get('NVIDIA_OCR_MODEL');
  return override && override.trim() ? override.trim() : fallback;
}

export interface NvidiaChatResult {
  content: string;
  model: string;
}

/**
 * POST an OpenAI-compatible chat/completions request to NVIDIA and return the
 * assistant text. Retries once on network error or 5xx (a 4xx — bad model/request —
 * won't fix on retry, so it fails fast). Throws an Error carrying the real upstream
 * status + body so callers can surface it instead of a generic message.
 */
export async function nvidiaChat(opts: {
  apiKey: string;
  messages: unknown[];
  fallbackModel: string;
  maxTokens?: number;
  temperature?: number;
  /** Ask the model for a strict JSON object (OpenAI-compatible response_format).
   *  Fixes models that otherwise return the data as markdown/bullets. */
  jsonMode?: boolean;
}): Promise<NvidiaChatResult> {
  const model = ocrModel(opts.fallbackModel);
  const payload = JSON.stringify({
    model,
    messages: opts.messages,
    max_tokens: opts.maxTokens ?? 4096,
    temperature: opts.temperature ?? 0.05,
    ...(opts.jsonMode ? { response_format: { type: 'json_object' } } : {}),
  });

  let lastErr = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Response;
    try {
      res = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.apiKey}` },
        body: payload,
      });
    } catch (e) {
      lastErr = `NVIDIA network error (model "${model}"): ${e instanceof Error ? e.message : String(e)}`;
      continue; // transient — retry once
    }
    if (res.ok) {
      const j = await res.json();
      return { content: j?.choices?.[0]?.message?.content ?? '', model };
    }
    const t = await res.text().catch(() => '(no body)');
    lastErr = `NVIDIA API ${res.status} for model "${model}": ${t.slice(0, 400)}`;
    if (res.status < 500) break; // 4xx won't be fixed by retrying
  }
  throw new Error(lastErr || 'NVIDIA vision call failed');
}
