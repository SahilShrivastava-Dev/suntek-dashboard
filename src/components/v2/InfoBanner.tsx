import React from 'react';
import { Info, AlertTriangle } from 'lucide-react';
import { cn } from '../../lib/utils/cn';

/** v2 info banner — soft blue strip w/ icon ("Anyone can scan this QR code…"). */
export function InfoBanner({
  tone = 'blue',
  children,
  className,
}: {
  tone?: 'blue' | 'amber';
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex items-start gap-2.5 rounded-[10px] px-4 py-3 text-[13px]',
        tone === 'blue' && 'bg-blue-50 text-slate-600',
        tone === 'amber' && 'bg-amber-50 text-amber-800',
        className,
      )}
    >
      {tone === 'blue'
        ? <Info size={15} className="text-blue-500 shrink-0 mt-0.5" />
        : <AlertTriangle size={15} className="text-amber-500 shrink-0 mt-0.5" />}
      <div>{children}</div>
    </div>
  );
}
