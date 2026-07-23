import React from 'react';
import { cn } from '../../lib/utils/cn';

/**
 * Neutral KPI card (mockup: Overview "Today's Work" — grey icon square, plain
 * label, big dark number, small caption). The standard stat-tile format across
 * pages; unlike StatCard it never colors the icon square or the number.
 */
export function WorkCard({ icon, label, value, caption, captionTone = 'slate', onClick, className, children }: {
  icon?: React.ReactNode;
  label: React.ReactNode;
  value?: React.ReactNode;
  caption?: React.ReactNode;
  captionTone?: 'slate' | 'orange' | 'green';
  onClick?: () => void;
  className?: string;
  /** Extra content below the value (e.g. a badge cloud instead of a number). */
  children?: React.ReactNode;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      {...(onClick ? { type: 'button' as const, onClick } : {})}
      className={cn(
        'text-left border border-slate-200 rounded-[10px] p-4 bg-white',
        onClick && 'hover:border-slate-300 hover:shadow-sm transition',
        className,
      )}
      style={{ fontFamily: 'inherit', cursor: onClick ? 'pointer' : 'default' }}
    >
      {icon && (
        <span className="w-8 h-8 rounded-lg bg-slate-50 border border-slate-100 text-slate-500 inline-flex items-center justify-center [&>svg]:w-4 [&>svg]:h-4 mb-3">
          {icon}
        </span>
      )}
      <div className="text-[12.5px] text-slate-600 leading-snug">{label}</div>
      {value !== undefined && (
        <div className="text-[26px] font-bold text-slate-900 leading-tight num">{value}</div>
      )}
      {caption && (
        <div className={`text-[11.5px] mt-0.5 ${captionTone === 'orange' ? 'text-orange-600 font-medium' : captionTone === 'green' ? 'text-green-600' : 'text-slate-400'}`}>
          {caption}
        </div>
      )}
      {children}
    </Tag>
  );
}
