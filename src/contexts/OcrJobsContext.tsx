import React, { createContext, useContext, useRef, useState } from 'react';
import { resizeImageToDataUrl } from '../lib/nvidiaOcr';

/**
 * Channel-keyed OCR job store, hoisted ABOVE the router so every OCR/upload flow
 * survives navigating away mid-extraction.
 *
 * Each upload surface picks a stable channel key ('daily-log', 'batch',
 * 'ocr-sales', 'ocr-purchase', …). The resize + extract run here and keep going
 * regardless of which page is mounted; a page reconnects to its channel's live
 * job when the user returns. extract*() in lib/nvidiaOcr use a plain fetch with
 * no unmount-abort, so the network request already continues — this provider is
 * what stops the *result* from being discarded.
 */

export type OcrStatus = 'idle' | 'ready' | 'processing' | 'done' | 'error';

export interface OcrJob<T = unknown> {
  status: OcrStatus;
  fileName: string | null;
  previewUrl: string | null;
  result: T | null;
  error: string | null;
  startedAt: number | null;
}

const BLANK: OcrJob = {
  status: 'idle', fileName: null, previewUrl: null, result: null, error: null, startedAt: null,
};

interface OcrJobsContextValue {
  getJob: <T = unknown>(key: string) => OcrJob<T>;
  /** Validate + resize the file → 'ready' (two-step flows). */
  select: (key: string, file: File, resizeWidth?: number) => Promise<void>;
  /** Run the extractor on the already-selected image → 'processing' → 'done'. */
  extract: <T>(key: string, extractor: (dataUrl: string) => Promise<T>) => Promise<void>;
  /** One-step convenience: select then extract. */
  run: <T>(key: string, file: File, extractor: (dataUrl: string) => Promise<T>, resizeWidth?: number) => Promise<void>;
  reset: (key: string) => void;
}

const OcrJobsContext = createContext<OcrJobsContextValue | null>(null);
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function OcrJobsProvider({ children }: { children: React.ReactNode }) {
  const [jobs, setJobs] = useState<Record<string, OcrJob>>({});
  const imagesRef = useRef<Record<string, string | null>>({}); // resized dataURL per channel
  const idsRef = useRef<Record<string, number>>({});           // monotonic id per channel

  function patch(key: string, p: Partial<OcrJob>) {
    setJobs((prev) => ({ ...prev, [key]: { ...(prev[key] ?? BLANK), ...p } }));
  }
  function bump(key: string) {
    idsRef.current[key] = (idsRef.current[key] ?? 0) + 1;
    return idsRef.current[key];
  }
  function revoke(url: string | null | undefined) {
    if (url) { try { URL.revokeObjectURL(url); } catch { /* ignore */ } }
  }

  async function select(key: string, file: File, resizeWidth = 1600) {
    const valid = file.type.startsWith('image/') || /\.(jpe?g|png|heic|webp)$/i.test(file.name);
    if (!valid) {
      patch(key, { ...BLANK, status: 'error', error: 'Please upload a JPG, PNG, or HEIC image.' });
      return;
    }
    const myId = bump(key);
    imagesRef.current[key] = null;
    setJobs((prev) => {
      revoke(prev[key]?.previewUrl);
      return { ...prev, [key]: { ...BLANK, status: 'ready', fileName: file.name, previewUrl: URL.createObjectURL(file) } };
    });
    try {
      const dataUrl = await resizeImageToDataUrl(file, resizeWidth);
      if (idsRef.current[key] !== myId) return; // superseded
      imagesRef.current[key] = dataUrl;
    } catch (e) {
      if (idsRef.current[key] !== myId) return;
      patch(key, { status: 'error', error: `Image processing failed: ${errMsg(e)}` });
    }
  }

  async function extract<T>(key: string, extractor: (dataUrl: string) => Promise<T>) {
    const img = imagesRef.current[key];
    if (!img) return;
    const myId = bump(key);
    patch(key, { status: 'processing', error: null, startedAt: Date.now() });
    try {
      const result = await extractor(img);
      if (idsRef.current[key] !== myId) return; // a newer job took over
      patch(key, { status: 'done', result });
    } catch (e) {
      if (idsRef.current[key] !== myId) return;
      patch(key, { status: 'error', error: errMsg(e) });
    }
  }

  async function run<T>(key: string, file: File, extractor: (dataUrl: string) => Promise<T>, resizeWidth = 1600) {
    await select(key, file, resizeWidth);
    if (imagesRef.current[key]) await extract(key, extractor); // only if select succeeded
  }

  function reset(key: string) {
    bump(key);
    imagesRef.current[key] = null;
    setJobs((prev) => { revoke(prev[key]?.previewUrl); return { ...prev, [key]: BLANK }; });
  }

  const getJob = <T,>(key: string) => (jobs[key] ?? BLANK) as OcrJob<T>;

  return (
    <OcrJobsContext.Provider value={{ getJob, select, extract, run, reset }}>
      {children}
    </OcrJobsContext.Provider>
  );
}

export function useOcrJobs(): OcrJobsContextValue {
  const ctx = useContext(OcrJobsContext);
  if (!ctx) throw new Error('useOcrJobs must be used inside <OcrJobsProvider>');
  return ctx;
}
