/**
 * QR helpers for the Fixed-Asset QR feature.
 *
 * A QR encodes an ABSOLUTE url to the asset profile using the current origin, so
 * the same build works on whichever host served it (Firebase or Vercel). The
 * token — not the raw asset id — is encoded so that "regenerate" can rotate it
 * and invalidate a previously printed code.
 */

/** 12-char url-safe token from a random UUID (regenerate → new token → old print dies). */
export function makeQrToken(): string {
  const uuid = (crypto as { randomUUID?: () => string }).randomUUID?.() ?? '';
  const clean = uuid.replace(/[^a-z0-9]/gi, '');
  const fallback = Math.abs(Date.now()).toString(36) + Math.random().toString(36).slice(2);
  return (clean || fallback).slice(0, 12).toLowerCase();
}

/** The URL a scanner opens. Same-origin so it boots the SPA on the serving host. */
export function assetQrUrl(token: string): string {
  return `${window.location.origin}/asset/${token}`;
}

/** Trigger a browser download of a data: URL. */
export function downloadDataUrl(dataUrl: string, filename: string): void {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Safe filename fragment from an asset label. */
export function safeFileName(s: string): string {
  return (s || 'asset').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'asset';
}

function escapeHtml(s: string): string {
  return (s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));
}

/**
 * Open a print-friendly label (QR + human-readable identifiers) in a new window
 * and fire the browser print dialog. `pngDataUrl` is the rendered QR image.
 */
export function printQrLabel(opts: { pngDataUrl: string; title: string; subtitle: string; footer: string }): void {
  const w = window.open('', '_blank', 'width=460,height=620');
  if (!w) return;
  const { pngDataUrl, title, subtitle, footer } = opts;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)} — QR label</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; margin: 0; padding: 24px; color: #0F172A; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .label { border: 2px solid #0F172A; border-radius: 16px; padding: 20px; text-align: center; max-width: 360px; margin: 0 auto; }
  .brand { font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: #64748B; font-weight: 700; }
  img { width: 240px; height: 240px; margin: 12px auto 8px; display: block; }
  .title { font-size: 18px; font-weight: 800; margin-top: 4px; }
  .subtitle { font-size: 13px; color: #475569; margin-top: 2px; }
  .footer { font-size: 11px; color: #94A3B8; margin-top: 8px; }
  @media print { body { padding: 0; } .label { border-color: #000; } }
</style></head>
<body onload="window.focus(); setTimeout(function(){ window.print(); }, 150);">
  <div class="label">
    <div class="brand">Suntek · Asset QR</div>
    <img src="${pngDataUrl}" alt="QR code" />
    <div class="title">${escapeHtml(title)}</div>
    <div class="subtitle">${escapeHtml(subtitle)}</div>
    <div class="footer">${escapeHtml(footer)}</div>
  </div>
</body></html>`);
  w.document.close();
}
