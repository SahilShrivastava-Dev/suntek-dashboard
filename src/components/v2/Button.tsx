import React from 'react';
import { cn } from '../../lib/utils/cn';

type Variant = 'primary' | 'outline' | 'accent' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

/**
 * v2 button — rectangular-rounded (10px), per the redesign mockups.
 *  - primary: dark navy fill (table "Complete", "Create requirement", wizard "Next")
 *  - outline: white w/ slate border ("Export", "View QR", "+ Generate QR", "Reset")
 *  - accent:  orange fill ("+ Add schedule", Quick search)
 *  - ghost:   borderless, hover slate (kebab/icon buttons)
 *  - danger:  red fill (destructive confirms)
 */
export function ButtonV2({
  variant = 'outline',
  size = 'md',
  icon,
  className,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-[10px] font-semibold transition-colors',
        'disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap',
        size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-[13px]',
        variant === 'primary' && 'bg-slate-900 text-white hover:bg-slate-700',
        variant === 'outline' && 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 hover:border-slate-300',
        variant === 'accent'  && 'bg-[#F47651] text-white hover:bg-[#C5421F]',
        variant === 'ghost'   && 'bg-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-700',
        variant === 'danger'  && 'bg-red-600 text-white hover:bg-red-700',
        className,
      )}
      {...rest}
    >
      {icon && <span className="inline-flex shrink-0 [&>svg]:w-3.5 [&>svg]:h-3.5">{icon}</span>}
      {children}
    </button>
  );
}
