import React from 'react';
import { clsx } from 'clsx';
import type { TileVariant } from '../../lib/utils/rbac';
import { TILE_META } from '../../lib/utils/rbac';
import { TrendingUp, TrendingDown } from 'lucide-react';

interface KPITileProps {
  variant: TileVariant;
  label: string;
  value: string;
  subtext?: string;
  change?: number;       // % change (positive = up, negative = down)
  changeLabel?: string;  // e.g. "vs last week"
  icon?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  onClick?: () => void;
}

const VARIANT_STYLES: Record<TileVariant, string> = {
  red:    'tile-red',
  green:  'tile-green',
  yellow: 'tile-yellow',
};

const VALUE_COLOR: Record<TileVariant, string> = {
  red:    'text-red-900',
  green:  'text-green-900',
  yellow: 'text-amber-900',
};

export function KPITile({
  variant,
  label,
  value,
  subtext,
  change,
  changeLabel = 'vs last week',
  icon,
  children,
  className,
  onClick,
}: KPITileProps) {
  const meta = TILE_META[variant];
  const isPositive = change !== undefined && change >= 0;
  const hasChange = change !== undefined;

  return (
    <div
      className={clsx(VARIANT_STYLES[variant], onClick && 'cursor-pointer hover:shadow-md', className)}
      onClick={onClick}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="kpi-label">{label}</p>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {icon && (
            <span className="text-gray-400">{icon}</span>
          )}
          <span className={meta.badgeClass}>
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-current opacity-70" />
            {meta.label}
          </span>
        </div>
      </div>

      {/* Value */}
      <p className={clsx('kpi-value mt-1', VALUE_COLOR[variant])}>{value}</p>

      {/* Subtext + change */}
      <div className="flex items-center justify-between gap-2 mt-1">
        {subtext && (
          <p className="text-xs text-gray-500 truncate">{subtext}</p>
        )}
        {hasChange && (
          <span
            className={clsx(
              'inline-flex items-center gap-0.5 text-xs font-medium flex-shrink-0',
              isPositive ? 'text-green-600' : 'text-red-600'
            )}
          >
            {isPositive ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
            {isPositive ? '+' : ''}{change!.toFixed(1)}% {changeLabel}
          </span>
        )}
      </div>

      {/* Optional children (e.g., progress bar, sub-list) */}
      {children && <div className="mt-2 pt-2 border-t border-black/5">{children}</div>}
    </div>
  );
}
