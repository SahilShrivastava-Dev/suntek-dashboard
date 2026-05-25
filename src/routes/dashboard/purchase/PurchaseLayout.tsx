import React from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';

const SUBTABS = [
  { id: 'far',      label: 'FAR',             count: 42 },
  { id: 'maint',    label: 'Maintenance',     count: 28 },
  { id: 'activity', label: 'Activity Log',    count: 14 },
  { id: 'storereq', label: 'Store Req',       count: 7  },
  { id: 'purchase', label: 'Purchase orders', count: 12 },
  { id: 'marine',   label: 'Marine Insurance'           },
  { id: 'labour',   label: 'Labour'                     },
];

function ArrowRight() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="2.4">
      <path d="M5 12h14M13 6l6 6-6 6"/>
    </svg>
  );
}

export function PurchaseLayout() {
  const location = useLocation();
  const navigate = useNavigate();

  // Determine active subtab from URL
  const segments = location.pathname.split('/');
  const lastSeg = segments[segments.length - 1];
  const activeTab = SUBTABS.find(t => t.id === lastSeg)?.id ?? 'far';

  function goToTab(id: string) {
    navigate(`/dashboard/purchase/${id}`);
  }

  return (
    <>
      {/* Purchase stage flow card */}
      <div className="card p-5 mb-5">
        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-3">
          Purchase flow · 4 stages
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="tile flex-1 min-w-[140px] text-center" onClick={() => goToTab('far')}>
            <div className="w-9 h-9 mx-auto mb-2 rounded-xl bg-purple-100 text-purple-600 flex items-center justify-center">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>
              </svg>
            </div>
            <div className="text-sm font-semibold">FAR</div>
            <div className="text-[11px] text-slate-500">Fixed Asset Register</div>
          </div>
          <ArrowRight />
          <div className="tile flex-1 min-w-[140px] text-center" onClick={() => goToTab('maint')}>
            <div className="w-9 h-9 mx-auto mb-2 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
              </svg>
            </div>
            <div className="text-sm font-semibold">Maintenance</div>
            <div className="text-[11px] text-slate-500">Regular + repair / scrap</div>
          </div>
          <ArrowRight />
          <div className="tile flex-1 min-w-[140px] text-center" onClick={() => goToTab('storereq')}>
            <div className="w-9 h-9 mx-auto mb-2 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
              </svg>
            </div>
            <div className="text-sm font-semibold">Store Req</div>
            <div className="text-[11px] text-slate-500">Unit head approves → Vijay Ji</div>
          </div>
          <ArrowRight />
          <div className="tile flex-1 min-w-[140px] text-center" onClick={() => goToTab('purchase')}>
            <div className="w-9 h-9 mx-auto mb-2 rounded-xl bg-orange-100 text-orange-600 flex items-center justify-center">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
              </svg>
            </div>
            <div className="text-sm font-semibold">Purchase</div>
            <div className="text-[11px] text-slate-500">PO via Busy (small reqs auth-only)</div>
          </div>
        </div>
        <div className="text-[11px] text-slate-500 mt-3">
          All four stages capture <span className="font-semibold text-slate-700">pic proof</span> — saved to OneDrive for future track record.
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex items-center gap-2 mb-5 overflow-x-auto scroll-x">
        {SUBTABS.map(t => (
          <div
            key={t.id}
            className={`subtab${activeTab === t.id ? ' active' : ''}`}
            onClick={() => goToTab(t.id)}
          >
            {t.label}
            {t.count !== undefined && (
              <span className="count">{t.count}</span>
            )}
          </div>
        ))}
      </div>

      {/* Active sub-page */}
      <Outlet />
    </>
  );
}
