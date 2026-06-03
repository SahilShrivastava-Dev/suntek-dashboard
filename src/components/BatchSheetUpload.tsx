/**
 * BatchSheetUpload — compact upload zone (left panel)
 *
 * Handles only: idle → ready → loading → error
 * Calls onExtracted(data, previewUrl) when AI returns structured data.
 * The review + save UI lives in BatchSheetReview (shown in the right panel).
 */
import React, { useState, useRef, useCallback } from 'react';
import {
  extractBatchSheet,
  resizeImageToDataUrl,
  type ExtractedBatchSheet,
} from '../lib/nvidiaOcr';

interface BatchSheetUploadProps {
  /** Called when extraction succeeds — parent renders the review panel */
  onExtracted: (data: ExtractedBatchSheet, previewUrl: string) => void;
  /** Whether the component should show as already-extracted (disable re-trigger) */
  reviewing?: boolean;
  /** Reset callback so user can re-upload while reviewing */
  onReset?: () => void;
  /** Display label for the document type (e.g. 'Batch Sheet', 'Sales', 'Purchase') */
  docLabel?: string;
  /** Accent color for the upload button (hex or CSS color) */
  accentColor?: string;
}

type Stage = 'idle' | 'ready' | 'loading' | 'error';

export function BatchSheetUpload({ onExtracted, reviewing, onReset, docLabel = 'Batch Sheet', accentColor = '#7c3aed' }: BatchSheetUploadProps) {
  const [stage, setStage] = useState<Stage>('idle');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setStage('idle');
    setPreviewUrl(null);
    setError(null);
    onReset?.();
  }, [onReset]);

  const handleFile = useCallback(async (file: File) => {
    const validTypes = /\.(jpe?g|png|heic|webp)$/i;
    if (!validTypes.test(file.name) && !file.type.startsWith('image/')) {
      setError('Please upload a JPG, PNG, or HEIC image.');
      setStage('error');
      return;
    }
    setError(null);
    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);
    try {
      const dataUrl = await resizeImageToDataUrl(file);
      setStage('ready');
      // Store for extraction
      fileInputRef.current && (fileInputRef.current.dataset.dataUrl = dataUrl);
    } catch (e: any) {
      setError(`Image processing failed: ${e?.message ?? e}`);
      setStage('error');
    }
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const handleExtract = async () => {
    const dataUrl = fileInputRef.current?.dataset.dataUrl;
    if (!dataUrl || !previewUrl) return;
    setStage('loading');
    setError(null);
    try {
      const data = await extractBatchSheet(dataUrl);
      onExtracted(data, previewUrl);
      // Keep preview visible but go back to idle (review is shown elsewhere)
      setStage('idle');
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setStage('error');
    }
  };

  // ── If parent is showing review, show a compact "reviewing" state ─────────
  if (reviewing) {
    return (
      <div className="flex flex-col gap-3">
        {previewUrl && (
          <img
            src={previewUrl}
            alt="Uploaded batch sheet"
            className="w-full rounded-xl object-cover border border-slate-200 shadow-sm max-h-48"
            style={{ objectPosition: 'top' }}
          />
        )}
        <div className="bg-violet-50 border border-violet-200 rounded-xl px-3 py-2.5 flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="2.5">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <span className="text-xs font-bold text-violet-700">Extraction complete — review on the right</span>
        </div>
        <button
          onClick={reset}
          className="w-full py-2 rounded-xl border-2 border-slate-200 text-xs font-bold text-slate-500 hover:bg-slate-50 transition"
        >
          ↩ Upload different sheet
        </button>
      </div>
    );
  }

  // ── Error state ───────────────────────────────────────────────────────────
  if (stage === 'error') {
    return (
      <div className="flex flex-col gap-3">
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <div className="text-xs font-bold text-red-700 mb-1">Extraction failed</div>
          <div className="text-xs text-red-600 leading-relaxed break-words whitespace-pre-wrap max-h-40 overflow-y-auto">
            {error}
          </div>
        </div>
        <button
          onClick={reset}
          className="w-full py-2.5 rounded-xl border-2 border-slate-200 text-sm font-bold text-slate-600 hover:bg-slate-50 transition"
        >
          ↩ Try Again
        </button>
      </div>
    );
  }

  // ── Loading state ─────────────────────────────────────────────────────────
  if (stage === 'loading') {
    return (
      <div className="flex flex-col items-center gap-4 py-6">
        {previewUrl && (
          <img
            src={previewUrl}
            alt="Batch sheet"
            className="w-full rounded-xl object-cover shadow border border-slate-200 max-h-40"
            style={{ objectPosition: 'top' }}
          />
        )}
        <svg className="animate-spin" width="28" height="28" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="#e2e8f0" strokeWidth="3" />
          <path d="M12 2 A10 10 0 0 1 22 12" stroke="#7c3aed" strokeWidth="3" strokeLinecap="round" />
        </svg>
        <div className="text-sm font-bold text-slate-700 text-center">Analyzing batch sheet…</div>
        <div className="text-xs text-slate-400 text-center">Llama 3.2 Vision 90B reading the table</div>
      </div>
    );
  }

  // ── Idle / Ready state ─────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-4">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/heic,image/webp,.jpg,.jpeg,.png,.heic,.webp"
        onChange={handleInputChange}
        className="hidden"
      />

      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className="cursor-pointer rounded-2xl border-2 border-dashed transition-all flex flex-col items-center justify-center gap-2 py-5 px-4 text-center"
        style={{
          borderColor: isDragging ? '#7c3aed' : '#cbd5e1',
          background: isDragging ? '#f5f3ff' : '#f8fafc',
        }}
      >
        {previewUrl ? (
          <>
            <img
              src={previewUrl}
              alt="Batch sheet preview"
              className="w-full rounded-xl object-cover shadow max-h-44"
              style={{ objectPosition: 'top' }}
            />
            <div className="text-xs text-slate-400">Tap to change</div>
          </>
        ) : (
          <>
            <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: `${accentColor}18` }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={accentColor} strokeWidth="2">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
            </div>
            <div className="text-sm font-bold text-slate-700">
              {isDragging ? 'Drop sheet here' : `Upload ${docLabel}`}
            </div>
            <div className="text-xs text-slate-400">Tap to select · JPG PNG HEIC</div>
          </>
        )}
      </div>

      {!previewUrl && (
        <div className="text-xs text-slate-400 leading-relaxed bg-slate-50 rounded-xl p-3 border border-slate-100">
          <span className="font-bold text-slate-500">How it works: </span>
          Photo the filled sheet → AI reads all rows → review on the right → save to DB.
        </div>
      )}

      {stage === 'ready' && (
        <button
          onClick={handleExtract}
          className="w-full py-3.5 rounded-xl text-white font-bold text-sm transition-all flex items-center justify-center gap-2"
          style={{ background: accentColor, boxShadow: `0 6px 16px -4px ${accentColor}72` }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
          Extract with AI
        </button>
      )}
    </div>
  );
}
