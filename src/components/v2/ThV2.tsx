import React from 'react';
import type { Sortable, SortDir } from '../ui/useSortable';

/**
 * v2 sortable header cell — same API as ui/useSortable's `Th` so table
 * migrations are an import swap. Visual styling comes from `table.dt2 thead th`;
 * this only adds the click handler + sort caret.
 */
export function ThV2({ children, sortKey, s, firstDir = 'asc', className, style }: {
  children: React.ReactNode;
  sortKey: string;
  s: Sortable;
  /** direction applied on the FIRST click (default 'asc'; pass 'desc' for dates/amounts). */
  firstDir?: SortDir;
  className?: string;
  style?: React.CSSProperties;
}) {
  const active = s.sort.key === sortKey;
  return (
    <th
      className={className}
      onClick={() => s.onSort(sortKey, firstDir)}
      title="Sort"
      style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', ...style }}
    >
      {children}
      <span aria-hidden style={{ marginLeft: 4, fontSize: 9, opacity: active ? 0.9 : 0.35 }}>
        {active ? (s.sort.dir === 'asc' ? '▲' : '▼') : '⇅'}
      </span>
    </th>
  );
}
