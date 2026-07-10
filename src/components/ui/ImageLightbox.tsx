import React, { useEffect, useState, useCallback } from 'react';

export interface LightboxImage {
  url: string;
  label?: string;
}

/**
 * Full-screen image viewer with prev/next, caption, and open-original. The app had
 * no shared lightbox — image viewing was ad-hoc inline `<img>` + "open in new tab".
 * Wire any camera/PIC affordance to this so evidence photos are inspectable in place.
 *
 * Renders nothing when `images` is empty. Controlled via `open`/`onClose`.
 */
export function ImageLightbox({
  images,
  open,
  onClose,
  startIndex = 0,
}: {
  images: LightboxImage[];
  open: boolean;
  onClose: () => void;
  startIndex?: number;
}) {
  const [idx, setIdx] = useState(startIndex);

  useEffect(() => { if (open) setIdx(Math.min(startIndex, Math.max(0, images.length - 1))); }, [open, startIndex, images.length]);

  const prev = useCallback(() => setIdx(i => (i - 1 + images.length) % images.length), [images.length]);
  const next = useCallback(() => setIdx(i => (i + 1) % images.length), [images.length]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') prev();
      else if (e.key === 'ArrowRight') next();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, prev, next]);

  if (!open || images.length === 0) return null;
  const cur = images[Math.min(idx, images.length - 1)];
  const multi = images.length > 1;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(15,23,42,0.85)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        style={{ position: 'absolute', top: 16, right: 20, width: 40, height: 40, borderRadius: '50%', border: 'none', background: 'rgba(255,255,255,0.12)', color: '#fff', fontSize: 22, cursor: 'pointer' }}
      >
        ×
      </button>

      {multi && (
        <button
          type="button"
          onClick={e => { e.stopPropagation(); prev(); }}
          aria-label="Previous image"
          style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', width: 44, height: 44, borderRadius: '50%', border: 'none', background: 'rgba(255,255,255,0.12)', color: '#fff', fontSize: 24, cursor: 'pointer' }}
        >
          ‹
        </button>
      )}

      <div onClick={e => e.stopPropagation()} style={{ maxWidth: '90vw', maxHeight: '88vh', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
        <img src={cur.url} alt={cur.label || 'Image'} style={{ maxWidth: '90vw', maxHeight: '78vh', objectFit: 'contain', borderRadius: 12, boxShadow: '0 10px 40px rgba(0,0,0,0.4)' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, color: '#E2E8F0', fontSize: 13 }}>
          {cur.label && <span style={{ fontWeight: 600 }}>{cur.label}</span>}
          {multi && <span style={{ color: '#94A3B8' }}>{idx + 1} / {images.length}</span>}
          <a href={cur.url} target="_blank" rel="noreferrer" style={{ color: '#FF8A66', fontWeight: 600, textDecoration: 'none' }}>Open original ↗</a>
        </div>
      </div>

      {multi && (
        <button
          type="button"
          onClick={e => { e.stopPropagation(); next(); }}
          aria-label="Next image"
          style={{ position: 'absolute', right: 16, top: '50%', transform: 'translateY(-50%)', width: 44, height: 44, borderRadius: '50%', border: 'none', background: 'rgba(255,255,255,0.12)', color: '#fff', fontSize: 24, cursor: 'pointer' }}
        >
          ›
        </button>
      )}
    </div>
  );
}
