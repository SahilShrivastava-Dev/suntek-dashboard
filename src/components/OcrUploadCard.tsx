import React, { useState, useEffect, useRef } from 'react';
import {
  SalesUploadPanel, PurchaseUploadPanel, SalesReviewPanel, PurchaseReviewPanel,
} from '../routes/operator/uploadPanels';
import type { ExtractedSalesSheet, ExtractedPurchaseSheet } from '../lib/nvidiaOcr';
import { extractSalesSheet, extractPurchaseSheet } from '../lib/nvidiaOcr';
import { useOcrJobs, type OcrStatus } from '../contexts/OcrJobsContext';
import { useBlacklistGuard } from '../lib/blacklist/guard';
import { useTranslation } from 'react-i18next';
import { useToast } from './ui/toast';

type Kind = 'sales' | 'purchase';

// Map the channel job status onto the upload panels' simpler stage prop.
function panelStage(status: OcrStatus): 'idle' | 'loading' | 'done' | 'error' {
  if (status === 'ready' || status === 'processing') return 'loading';
  if (status === 'done') return 'done';
  if (status === 'error') return 'error';
  return 'idle';
}

/**
 * Collapsible "Upload sheet (OCR)" card for the Sales and Purchase pages.
 * The OCR job runs in the OcrJobsProvider (above the router) so it keeps going
 * and reconnects if the user navigates away mid-extraction.
 */
export function OcrUploadCard({ kind }: { kind: Kind }) {
  const { t } = useTranslation();
  const toast = useToast();
  const screenBlacklist = useBlacklistGuard();
  const ocr = useOcrJobs();
  const [open, setOpen] = useState(false);
  const screenedRef = useRef<unknown>(null);

  const isSales = kind === 'sales';
  const channel = `ocr-${kind}`;
  const accent = isSales ? '#16a34a' : '#dc2626';
  const title = isSales ? t('ocr.uploadSalesTitle') : t('ocr.uploadPurchaseTitle');

  const job = isSales
    ? ocr.getJob<ExtractedSalesSheet>(channel)
    : ocr.getJob<ExtractedPurchaseSheet>(channel);

  function handleFile(file: File) {
    setOpen(true);
    const extractor: (dataUrl: string) => Promise<ExtractedSalesSheet | ExtractedPurchaseSheet> =
      isSales ? extractSalesSheet : extractPurchaseSheet;
    ocr.run(channel, file, extractor);
  }
  const reset = () => { screenedRef.current = null; ocr.reset(channel); };

  // Screen the extracted parties against the blacklist once, when the result lands.
  useEffect(() => {
    if (job.status !== 'done' || !job.result) return;
    if (screenedRef.current === job.result) return;
    screenedRef.current = job.result;
    if (isSales) {
      const d = job.result as ExtractedSalesSheet;
      screenBlacklist(
        [
          { value: d.customerName ?? '', label: 'Customer' },
          { value: d.vehicleNumber ?? '', label: 'Vehicle' },
          { value: d.driverName ?? '', label: 'Driver' },
        ],
        { workflow: 'Sales Sheet OCR', source: 'ocr', entityLabel: d.dcNumber ? `DC ${d.dcNumber}` : 'Sales sheet' },
      );
    } else {
      const d = job.result as ExtractedPurchaseSheet;
      screenBlacklist(
        [
          { value: d.supplierName ?? '', label: 'Supplier' },
          { value: d.supplierGstin ?? '', label: 'GSTIN' },
          { value: d.buyerName ?? '', label: 'Buyer' },
        ],
        { workflow: 'Purchase Sheet OCR', source: 'ocr', entityLabel: d.invoiceNumber ? `Invoice ${d.invoiceNumber}` : 'Purchase sheet' },
      );
    }
  }, [job.status, job.result, isSales, screenBlacklist]);

  const stage = panelStage(job.status);
  const panelState = { stage, imageUrl: job.previewUrl ?? undefined, error: job.error ?? undefined };

  return (
    <div className="card p-5 mb-5">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span style={{ width: 30, height: 30, borderRadius: 9, background: `${accent}14`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={accent} strokeWidth="2.4">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </span>
          <div className="text-left">
            <div className="text-[14px] font-bold text-slate-800">{title}</div>
            <div className="text-[11px] text-slate-500">
              {job.status === 'processing' ? t('ocr.extracting') : t('ocr.snapHint')}
            </div>
          </div>
        </div>
        <svg className="transition-transform duration-200" style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="2.4"><path d="m9 6 6 6-6 6" /></svg>
      </button>

      {open && (
        <div className="mt-4">
          {job.status === 'done' && job.result ? (
            isSales ? (
              <SalesReviewPanel
                data={job.result as ExtractedSalesSheet}
                imageUrl={job.previewUrl!}
                onSaved={() => { reset(); toast.success(t('ocr.salesSheetSaved')); }}
                onCancel={reset}
              />
            ) : (
              <PurchaseReviewPanel
                data={job.result as ExtractedPurchaseSheet}
                imageUrl={job.previewUrl!}
                onClose={reset}
              />
            )
          ) : (
            <div className="max-w-md">
              {isSales ? (
                <SalesUploadPanel state={panelState} onFileSelect={handleFile} onReset={reset} />
              ) : (
                <PurchaseUploadPanel state={panelState} onFileSelect={handleFile} onReset={reset} />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
