import React, { useState } from 'react';
import {
  SalesUploadPanel, PurchaseUploadPanel, SalesReviewPanel, PurchaseReviewPanel,
} from '../routes/operator/uploadPanels';
import type { ExtractedSalesSheet, ExtractedPurchaseSheet } from '../lib/nvidiaOcr';
import { resizeImageToDataUrl, extractSalesSheet, extractPurchaseSheet } from '../lib/nvidiaOcr';
import { useBlacklistGuard } from '../lib/blacklist/guard';
import { useToast } from './ui/toast';

type Kind = 'sales' | 'purchase';

interface UploadState {
  stage: 'idle' | 'loading' | 'done' | 'error';
  data?: ExtractedSalesSheet | ExtractedPurchaseSheet;
  imageUrl?: string;
  error?: string;
}

/**
 * Collapsible "Upload sheet (OCR)" card for the Sales and Purchase pages.
 *
 * The Sales/Purchase OCR upload used to live inside the Technical Team's batch
 * logger. It now belongs here, where only Admin / Unit Head / Accountant reach it
 * (gate at the call site via the active profile). Saving happens inside the
 * review panels; this card only owns the upload → extract → review lifecycle.
 */
export function OcrUploadCard({ kind }: { kind: Kind }) {
  const toast = useToast();
  const screenBlacklist = useBlacklistGuard();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<UploadState>({ stage: 'idle' });

  const isSales = kind === 'sales';
  const accent = isSales ? '#16a34a' : '#dc2626';
  const title = isSales ? 'Upload sales sheet (OCR)' : 'Upload purchase sheet (OCR)';

  async function handleFile(file: File) {
    const url = URL.createObjectURL(file);
    setState({ stage: 'loading', imageUrl: url });
    try {
      const dataUrl = await resizeImageToDataUrl(file);
      if (isSales) {
        const data = await extractSalesSheet(dataUrl);
        setState({ stage: 'done', data, imageUrl: url });
        screenBlacklist(
          [
            { value: data.customerName ?? '', label: 'Customer' },
            { value: data.vehicleNumber ?? '', label: 'Vehicle' },
            { value: data.driverName ?? '', label: 'Driver' },
          ],
          { workflow: 'Sales Sheet OCR', source: 'ocr', entityLabel: data.dcNumber ? `DC ${data.dcNumber}` : 'Sales sheet' },
        );
      } else {
        const data = await extractPurchaseSheet(dataUrl);
        setState({ stage: 'done', data, imageUrl: url });
        screenBlacklist(
          [
            { value: data.supplierName ?? '', label: 'Supplier' },
            { value: data.supplierGstin ?? '', label: 'GSTIN' },
            { value: data.buyerName ?? '', label: 'Buyer' },
          ],
          { workflow: 'Purchase Sheet OCR', source: 'ocr', entityLabel: data.invoiceNumber ? `Invoice ${data.invoiceNumber}` : 'Purchase sheet' },
        );
      }
    } catch (e) {
      setState({ stage: 'error', error: e instanceof Error ? e.message : String(e), imageUrl: url });
    }
  }

  const reset = () => setState({ stage: 'idle' });

  return (
    <div className="card p-5 mb-5">
      {/* Header / toggle */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between"
      >
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
            <div className="text-[11px] text-slate-500">Snap or upload a sheet — OCR extracts the fields for review</div>
          </div>
        </div>
        <svg className="transition-transform duration-200" style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="2.4"><path d="m9 6 6 6-6 6" /></svg>
      </button>

      {open && (
        <div className="mt-4">
          {state.stage === 'done' && state.data ? (
            isSales ? (
              <SalesReviewPanel
                data={state.data as ExtractedSalesSheet}
                imageUrl={state.imageUrl!}
                onSaved={() => { reset(); toast.success('Sales sheet saved!'); }}
                onCancel={reset}
              />
            ) : (
              <PurchaseReviewPanel
                data={state.data as ExtractedPurchaseSheet}
                imageUrl={state.imageUrl!}
                onClose={reset}
              />
            )
          ) : (
            <div className="max-w-md">
              {isSales ? (
                <SalesUploadPanel state={state} onFileSelect={handleFile} onReset={reset} />
              ) : (
                <PurchaseUploadPanel state={state} onFileSelect={handleFile} onReset={reset} />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
