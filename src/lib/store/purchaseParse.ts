/**
 * purchaseParse — turn a purchase bill (image or PDF) into line items and match
 * each against the existing stock register.
 *
 * Reuses the existing `extract-purchase-sheet` NVIDIA-vision edge function
 * (returns description/quantity/unit/rate/amount + invoice totals) and the
 * blacklist `similarity()` for fuzzy matching. PDFs are rasterised page-by-page
 * with pdf.js before OCR.
 */
import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { resizeImageToDataUrl, extractPurchaseSheet, type ExtractedPurchaseSheet, type PurchaseLineItem } from '../nvidiaOcr';
import { similarity } from '../blacklist/similarity';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

/** A bill (image or PDF) → one image data-URL per page (PDFs capped at maxPages). */
export async function billToImages(file: File, maxPages = 5): Promise<string[]> {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (!isPdf) return [await resizeImageToDataUrl(file, 1600)];

  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const pages: string[] = [];
  const n = Math.min(pdf.numPages, maxPages);
  for (let i = 1; i <= n; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;
    await page.render({ canvasContext: ctx, viewport }).promise;
    pages.push(canvas.toDataURL('image/jpeg', 0.85));
  }
  return pages;
}

export interface ParsedBill {
  invoiceNumber: string | null;
  supplierName: string | null;
  lineItems: PurchaseLineItem[];
  totalAmount: number | null;
  pages: number;
}

/** OCR every page and merge the line items into one bill. */
export async function parseBill(file: File): Promise<ParsedBill> {
  const images = await billToImages(file);
  if (!images.length) throw new Error('Could not read any page from this file.');
  const results: ExtractedPurchaseSheet[] = [];
  for (const img of images) {
    try { results.push(await extractPurchaseSheet(img)); }
    catch { /* skip a page that fails to OCR; others may still succeed */ }
  }
  if (!results.length) throw new Error('The bill could not be read. Try a clearer photo or a different page.');
  const lineItems = results.flatMap(r => r.lineItems || []).filter(li => (li.description || '').trim());
  const totalAmount = results.reduce<number | null>((acc, r) => (r.totalAmount != null ? (acc ?? 0) + r.totalAmount : acc), null);
  return {
    invoiceNumber: results.find(r => r.invoiceNumber)?.invoiceNumber ?? null,
    supplierName: results.find(r => r.supplierName)?.supplierName ?? null,
    lineItems, totalAmount, pages: images.length,
  };
}

export interface StockLite { id: string; item_name: string; on_hand: number; unit: string | null }
export interface MatchCandidate extends StockLite { score: number }

/** Top-N fuzzy matches for a purchased item name against the plant's stock. */
export function matchCandidates(name: string, stock: StockLite[], topN = 3): MatchCandidate[] {
  const q = (name || '').trim();
  if (q.length < 2) return [];
  return stock
    .map(s => ({ ...s, score: similarity(q, s.item_name) }))
    .filter(x => x.score > 0.3)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}
