import type React from 'react';

/**
 * Positioning for a top-bar dropdown panel.
 *
 * Desktop: classic absolute panel anchored under its trigger, right-aligned.
 * Mobile (<768px): the trigger can sit anywhere in a wrapped icon row, so we pin
 * the panel to the VIEWPORT's right edge — just below the trigger, a capped
 * width (not full-screen) with a comfortable left gutter — so it always fits,
 * stays on the right, and never gets cut off.
 */
export function dropdownStyle(btn: HTMLElement | null, width: number, maxHeight: number): React.CSSProperties {
  if (typeof window !== 'undefined' && window.innerWidth < 768) {
    const bottom = Math.round(btn?.getBoundingClientRect().bottom ?? 56);
    const capped = Math.min(width, 340);
    return {
      position: 'fixed',
      top: bottom + 8,
      right: 12,
      width: `min(${capped}px, calc(100vw - 48px))`,
      maxHeight: `calc(100vh - ${bottom + 20}px)`,
    };
  }
  return { position: 'absolute', top: 'calc(100% + 8px)', right: 0, width, maxHeight };
}
