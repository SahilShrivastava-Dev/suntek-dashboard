import React, { createContext, useContext, useRef, useState } from 'react';
import { extractDailyLog, resizeImageToDataUrl, type ExtractedDailyLog } from '../lib/nvidiaOcr';

/**
 * Daily Unit Log OCR job, hoisted ABOVE the router so it survives navigation.
 *
 * Problem it solves: the OCR call ran inside DailyLogPage. Navigating to another
 * tab mid-extraction unmounted the page, so the in-flight result was discarded
 * and the user had to start over. This provider holds the job and runs the
 * extraction, so the network call keeps going and the page simply reconnects to
 * the live job state when the user returns.
 */

export type DailyLogOcrStatus = 'idle' | 'ready' | 'processing' | 'done' | 'error';

interface JobState {
  status: DailyLogOcrStatus;
  fileName: string | null;
  previewUrl: string | null;
  result: ExtractedDailyLog | null;
  error: string | null;
  startedAt: number | null;
}

const BLANK: JobState = {
  status: 'idle', fileName: null, previewUrl: null, result: null, error: null, startedAt: null,
};

interface DailyLogOcrContextValue {
  job: JobState;
  /** Validate + resize the chosen file and move to 'ready'. */
  selectFile: (file: File) => Promise<void>;
  /** Kick off the (background-safe) OCR extraction. */
  extract: () => Promise<void>;
  /** Clear the job back to idle. */
  reset: () => void;
}

const DailyLogOcrContext = createContext<DailyLogOcrContextValue | null>(null);

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function DailyLogOcrProvider({ children }: { children: React.ReactNode }) {
  const [job, setJob] = useState<JobState>(BLANK);
  const apiImageRef = useRef<string | null>(null);
  // Monotonic id so a superseded job's async result is ignored.
  const jobIdRef = useRef(0);

  function revoke(url: string | null) {
    if (url) { try { URL.revokeObjectURL(url); } catch { /* ignore */ } }
  }

  async function selectFile(file: File) {
    const valid = file.type.startsWith('image/') || /\.(jpe?g|png|heic|webp)$/i.test(file.name);
    if (!valid) {
      setJob({ ...BLANK, status: 'error', error: 'Please upload a JPG, PNG, or HEIC image.' });
      return;
    }
    const myId = ++jobIdRef.current;
    apiImageRef.current = null;
    setJob((prev) => {
      revoke(prev.previewUrl);
      return { ...BLANK, status: 'ready', fileName: file.name, previewUrl: URL.createObjectURL(file) };
    });
    try {
      // 1200px keeps the base64 payload small while staying legible for the model.
      const apiImage = await resizeImageToDataUrl(file, 1200);
      if (jobIdRef.current !== myId) return; // superseded
      apiImageRef.current = apiImage;
    } catch (e) {
      if (jobIdRef.current !== myId) return;
      setJob((j) => ({ ...j, status: 'error', error: `Image processing failed: ${errMsg(e)}` }));
    }
  }

  async function extract() {
    const img = apiImageRef.current;
    if (!img) return;
    const myId = ++jobIdRef.current;
    setJob((j) => ({ ...j, status: 'processing', error: null, startedAt: Date.now() }));
    try {
      const result = await extractDailyLog(img);
      if (jobIdRef.current !== myId) return; // a newer job took over — drop this result
      setJob((j) => ({ ...j, status: 'done', result }));
    } catch (e) {
      if (jobIdRef.current !== myId) return;
      setJob((j) => ({ ...j, status: 'error', error: errMsg(e) }));
    }
  }

  function reset() {
    jobIdRef.current++; // invalidate any in-flight job
    apiImageRef.current = null;
    setJob((prev) => { revoke(prev.previewUrl); return BLANK; });
  }

  return (
    <DailyLogOcrContext.Provider value={{ job, selectFile, extract, reset }}>
      {children}
    </DailyLogOcrContext.Provider>
  );
}

export function useDailyLogOcr(): DailyLogOcrContextValue {
  const ctx = useContext(DailyLogOcrContext);
  if (!ctx) throw new Error('useDailyLogOcr must be used inside <DailyLogOcrProvider>');
  return ctx;
}
