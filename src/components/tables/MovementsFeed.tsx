import React, { useState } from 'react';
import { Search } from 'lucide-react';
import { clsx } from 'clsx';
export interface Movement {
  id: string;
  type: 'purchase' | 'sales' | 'batch' | 'stock' | 'maintenance' | 'night_manager';
  title: string;
  detail: string;
  plant: string;
  source: 'api' | 'excel' | 'manual';
  timestamp: string;
}

import { relativeTime } from '../../lib/utils/formatting';

const TYPE_CONFIG = {
  purchase:      { label: 'Purchase',      dot: 'bg-blue-500',   pill: 'bg-blue-50 text-blue-700' },
  sales:         { label: 'Sales',         dot: 'bg-green-500',  pill: 'bg-green-50 text-green-700' },
  batch:         { label: 'Batch',         dot: 'bg-purple-500', pill: 'bg-purple-50 text-purple-700' },
  stock:         { label: 'Stock',         dot: 'bg-amber-500',  pill: 'bg-amber-50 text-amber-700' },
  maintenance:   { label: 'Maintenance',   dot: 'bg-red-400',    pill: 'bg-red-50 text-red-700' },
  night_manager: { label: 'Night Mgr',     dot: 'bg-indigo-500', pill: 'bg-indigo-50 text-indigo-700' },
};

const SOURCE_BADGE = {
  api:    'badge-api',
  excel:  'badge-excel',
  manual: 'badge-manual',
};

const SOURCE_LABEL = {
  api:    'Busy API',
  excel:  'Excel',
  manual: 'Manual',
};

const FILTER_OPTIONS = ['All', 'Purchase', 'Sales', 'Batch', 'Stock', 'Maintenance', 'Night Mgr'] as const;

interface MovementsFeedProps {
  movements: Movement[];
  limit?: number;
}

export function MovementsFeed({ movements, limit }: MovementsFeedProps) {
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<string>('All');

  const filtered = movements.filter((m) => {
    const matchesSearch =
      !search ||
      m.title.toLowerCase().includes(search.toLowerCase()) ||
      m.detail.toLowerCase().includes(search.toLowerCase()) ||
      m.plant.toLowerCase().includes(search.toLowerCase());

    const matchesFilter =
      activeFilter === 'All' ||
      TYPE_CONFIG[m.type].label === activeFilter ||
      (activeFilter === 'Night Mgr' && m.type === 'night_manager');

    return matchesSearch && matchesFilter;
  });

  const visible = limit ? filtered.slice(0, limit) : filtered;

  return (
    <div className="flex flex-col gap-3">
      {/* Search + filter chips */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search movements…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-300 focus:border-transparent"
          />
        </div>
        <div className="flex gap-1 flex-wrap">
          {FILTER_OPTIONS.map((f) => (
            <button
              key={f}
              onClick={() => setActiveFilter(f)}
              className={clsx(
                'px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors',
                activeFilter === f
                  ? 'bg-gray-900 text-white border-gray-900'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300 hover:text-gray-800'
              )}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Feed */}
      <div className="space-y-1">
        {visible.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">No movements match your filter.</p>
        ) : (
          visible.map((m) => {
            const cfg = TYPE_CONFIG[m.type];
            return (
              <div
                key={m.id}
                className="flex items-start gap-3 p-3 rounded-lg hover:bg-gray-50 transition-colors cursor-default"
              >
                {/* Dot */}
                <div className="flex-shrink-0 mt-1.5">
                  <span className={clsx('status-dot', cfg.dot)} />
                </div>
                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start gap-2 flex-wrap">
                    <p className="text-sm font-medium text-gray-800">{m.title}</p>
                    <span className={clsx('source-badge', SOURCE_BADGE[m.source], 'flex-shrink-0')}>
                      {SOURCE_LABEL[m.source]}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">{m.detail}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={clsx('text-[10px] font-medium px-1.5 py-0.5 rounded-md', cfg.pill)}>
                      {cfg.label}
                    </span>
                    <span className="text-[10px] text-gray-400">{m.plant}</span>
                    <span className="text-[10px] text-gray-300">·</span>
                    <span className="text-[10px] text-gray-400">{relativeTime(m.timestamp)}</span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
