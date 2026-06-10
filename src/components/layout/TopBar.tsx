import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ProfileSwitcher } from './ProfileSwitcher';
import { useRoleContext } from '../../contexts/RoleContext';

// ── Notification definitions ──────────────────────────────────────────────────

type NType = 'urgent' | 'warning' | 'info';

interface Notif {
  id: string;
  title: string;
  sub: string;
  type: NType;
  time: string;
  route?: string;
}

const NOTIFS_BY_PROFILE: Record<string, Notif[]> = {
  admin: [
    { id: 'a1', title: '7 store requisitions pending',       sub: 'Awaiting Vijay Ji authorisation',            type: 'urgent',  time: '2h ago',  route: '/dashboard/purchase/storereq' },
    { id: 'a2', title: 'Marine insurance: ₹50 L to threshold', sub: 'Balance ₹9.50 Cr of ₹10 Cr limit',        type: 'urgent',  time: '4h ago',  route: '/dashboard/purchase/marine' },
    { id: 'a3', title: '3 FAR assets flagged for repair',    sub: 'Awaiting closure on maintenance side',       type: 'warning', time: '1d ago',  route: '/dashboard/purchase/far' },
    { id: 'a4', title: 'GST output MTD not reconciled',      sub: 'Sales GST pending Busy sync',                type: 'warning', time: '1d ago',  route: '/dashboard/sales' },
    { id: 'a5', title: '2 customers overdue payment',        sub: '₹2.1 Cr outstanding beyond 60 days',        type: 'warning', time: '2d ago',  route: '/dashboard/customers' },
    { id: 'a6', title: 'Night Manager: Ganjam unchecked',    sub: 'No check-in logged last night',             type: 'info',    time: '8h ago',  route: '/dashboard/night-manager' },
    { id: 'a7', title: 'Batch B-441 running 8 h over estimate', sub: 'SHD plant · operator logged 6 h gap',   type: 'info',    time: '3h ago',  route: '/dashboard/batches' },
  ],

  unit_head: [
    { id: 'u1', title: '7 store requisitions need your approval', sub: 'SR-441 to SR-435 awaiting Unit Head',   type: 'urgent',  time: '2h ago',  route: '/dashboard/purchase/storereq' },
    { id: 'u2', title: 'Jharsuguda tank B-4 below 30%',      sub: 'CPM stock alert — consider replenishment',  type: 'urgent',  time: '5h ago',  route: '/dashboard/stock' },
    { id: 'u3', title: '3 FAR assets pending repair closure', sub: 'Flag open since last maintenance cycle',   type: 'warning', time: '1d ago',  route: '/dashboard/purchase/far' },
    { id: 'u4', title: 'Batch B-441 delayed',                 sub: '8 h over estimate at SHD plant',           type: 'warning', time: '3h ago',  route: '/dashboard/batches' },
    { id: 'u5', title: '2 activity logs pending verification', sub: 'Cooling tower + air compressor entries',  type: 'info',    time: '6h ago',  route: '/dashboard/purchase/activity' },
  ],

  warehouse_manager: [
    { id: 'w1', title: 'SR-441 approved — ready to dispatch', sub: 'PP Ball · 48 nos · from SHD store',        type: 'urgent',  time: '1h ago',  route: '/dashboard/purchase/storereq' },
    { id: 'w2', title: 'Rehla tank B-4 below 30%',           sub: 'Current: 22% — schedule top-up',           type: 'urgent',  time: '4h ago',  route: '/dashboard/stock' },
    { id: 'w3', title: '3 requisitions to acknowledge',       sub: 'SR-440, SR-438, SR-435 in your queue',     type: 'warning', time: '3h ago',  route: '/dashboard/purchase/storereq' },
    { id: 'w4', title: 'Daily stock entry pending',           sub: 'Today\'s register not yet submitted',      type: 'info',    time: '2h ago',  route: '/dashboard/warehouse-entry' },
  ],

  labour_manager: [
    { id: 'l1', title: 'SHD plant 3.2% over labour target',  sub: '₹1,487 / MT vs target ₹1,450',             type: 'urgent',  time: '2h ago',  route: '/dashboard/purchase/labour' },
    { id: 'l2', title: 'Ganjam plant variance flagged',       sub: 'Labour cost trending above monthly budget', type: 'warning', time: '5h ago',  route: '/dashboard/purchase/labour' },
    { id: 'l3', title: '2 activity logs need verification',   sub: 'Cooling tower motor + compressor repair',  type: 'warning', time: '6h ago',  route: '/dashboard/purchase/activity' },
    { id: 'l4', title: 'MTD labour ↑ 3.2% vs last month',    sub: '₹71.1 L so far — review formula',          type: 'info',    time: '1d ago',  route: '/dashboard/purchase/labour' },
  ],

  night_manager: [
    { id: 'n1', title: 'Check-in due tonight at 10 PM',      sub: 'Rehla plant · GPS + photo required',        type: 'urgent',  time: 'Now',     route: '/dashboard/night-entry' },
    { id: 'n2', title: 'Ganjam check-in missing last night', sub: 'System flagged absence — log reason',       type: 'warning', time: '8h ago',  route: '/dashboard/night-entry' },
    { id: 'n3', title: 'Photo proof upload pending',         sub: 'Last night\'s shift photo not uploaded',    type: 'info',    time: '10h ago', route: '/dashboard/night-entry' },
  ],

  factory_operator: [
    { id: 'f1', title: 'Batch B-441: 6 h log gap detected',  sub: 'SHD plant — add a mid-shift reading',       type: 'urgent',  time: '3h ago',  route: '/dashboard/batch-entry' },
    { id: 'f2', title: 'Daily unit log not uploaded today',   sub: 'OCR upload pending for today\'s sheet',     type: 'urgent',  time: '2h ago',  route: '/dashboard/batch-entry' },
    { id: 'f3', title: 'Sales sheet for May not digitised',   sub: 'Upload photo for OCR extraction',           type: 'warning', time: '1d ago',  route: '/dashboard/batch-entry' },
  ],

  accountant_delhi: [
    { id: 'd1', title: 'GST filing deadline: 5 days',        sub: 'GSTR-1 due for Apr 2026 · Delhi factory',   type: 'urgent',  time: '1d ago',  route: '/dashboard/sales' },
    { id: 'd2', title: '2 customers overdue payment',        sub: '₹2.1 Cr outstanding beyond 60 days',        type: 'urgent',  time: '2d ago',  route: '/dashboard/customers' },
    { id: 'd3', title: 'Marine insurance near threshold',    sub: 'Balance ₹9.50 Cr — top-up soon',             type: 'warning', time: '4h ago',  route: '/dashboard/purchase/marine' },
    { id: 'd4', title: 'Sales reconciliation for Apr pending', sub: 'BUSY vs dashboard figures to match',      type: 'warning', time: '1d ago',  route: '/dashboard/sales' },
    { id: 'd5', title: 'Labour cost MTD up 3.2%',            sub: 'Variance note required for audit',          type: 'info',    time: '2d ago',  route: '/dashboard/purchase/labour' },
  ],

  accountant_other: [
    { id: 'o1', title: 'GST filing deadline: 5 days',        sub: 'GSTR-1 due for Apr 2026 · Rehla & Jharsuguda', type: 'urgent', time: '1d ago', route: '/dashboard/sales' },
    { id: 'o2', title: '3 sales invoices un-reconciled',     sub: 'Apr invoices not matched to bank receipts', type: 'urgent',  time: '2d ago',  route: '/dashboard/sales' },
    { id: 'o3', title: 'Labour cost variance at SHD',        sub: '₹1,487 / MT — 2.5% over budget',            type: 'warning', time: '1d ago',  route: '/dashboard/purchase/labour' },
    { id: 'o4', title: 'Purchase reconciliation pending',    sub: 'Apr purchase entries vs BUSY ledger',        type: 'warning', time: '2d ago',  route: '/dashboard/purchase/purchase' },
  ],
};

// ── Colour helpers ────────────────────────────────────────────────────────────

const DOT: Record<NType, string>   = { urgent: '#DC2626', warning: '#D97706', info: '#2563EB' };
const ICON_BG: Record<NType, string> = { urgent: '#FEE2E2', warning: '#FEF3C7', info: '#DBEAFE' };
const ICON_COLOR: Record<NType, string> = { urgent: '#DC2626', warning: '#D97706', info: '#2563EB' };

function TypeIcon({ type }: { type: NType }) {
  if (type === 'urgent') return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
  );
  if (type === 'warning') return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
    </svg>
  );
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
    </svg>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

interface TopBarProps {
  title: string;
  breadcrumb: string;
}

export function TopBar({ title, breadcrumb }: TopBarProps) {
  const navigate = useNavigate();
  const { activeProfile } = useRoleContext();
  const [open, setOpen] = useState(false);
  const [read, setRead] = useState<Set<string>>(new Set());
  const panelRef = useRef<HTMLDivElement>(null);
  const btnRef   = useRef<HTMLButtonElement>(null);

  const notifs: Notif[] = NOTIFS_BY_PROFILE[activeProfile.id] ?? [];
  const unread = notifs.filter(n => !read.has(n.id)).length;

  // Close panel when clicking outside
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        btnRef.current   && !btnRef.current.contains(e.target as Node)
      ) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Reset read state when profile changes
  useEffect(() => { setRead(new Set()); setOpen(false); }, [activeProfile.id]);

  function markRead(id: string) { setRead(prev => new Set([...prev, id])); }
  function markAllRead() { setRead(new Set(notifs.map(n => n.id))); }

  function handleNotifClick(n: Notif) {
    markRead(n.id);
    if (n.route) { navigate(n.route); setOpen(false); }
  }

  return (
    <div className="flex items-center justify-between gap-4 mb-5 flex-wrap">
      {/* Left: title block */}
      <div className="flex items-center gap-3">
        <div>
          <div className="text-[12px] text-slate-500">{breadcrumb}</div>
          <h1 className="serif text-[34px] leading-[1] mt-0.5">{title}</h1>
        </div>
      </div>

      {/* Right: live indicator + notifications + profile switcher */}
      <div className="flex items-center gap-2" style={{ position: 'relative' }}>
        {/* Live sync pill */}
        <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-200 rounded-full text-[12px]">
          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
          <span className="font-medium">Live</span>
          <span className="text-slate-400">· last sync 12s</span>
        </div>

        {/* Bell button */}
        <button
          ref={btnRef}
          className="w-10 h-10 rounded-full bg-white border border-slate-200 hover:bg-slate-50 flex items-center justify-center relative"
          onClick={() => setOpen(v => !v)}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/>
            <path d="M10 21a2 2 0 0 0 4 0"/>
          </svg>
          {unread > 0 && (
            <span style={{
              position: 'absolute', top: 6, right: 6,
              width: 16, height: 16, borderRadius: '50%',
              background: '#F47651', border: '2px solid #fff',
              fontSize: 9, fontWeight: 700, color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>

        {/* Notification dropdown */}
        {open && (
          <div
            ref={panelRef}
            style={{
              position: 'absolute', top: 'calc(100% + 8px)', right: 0,
              width: 360, maxHeight: 520,
              background: '#fff', border: '1px solid #E2E8F0',
              borderRadius: 20, boxShadow: '0 12px 40px rgba(0,0,0,0.12)',
              zIndex: 200, display: 'flex', flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            {/* Header */}
            <div style={{ padding: '16px 18px 12px', borderBottom: '1px solid #F1F5F9', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#0F172A' }}>Notifications</div>
                  <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 1 }}>
                    {activeProfile.roleLabel} · {activeProfile.name}
                  </div>
                </div>
                {unread > 0 && (
                  <button
                    onClick={markAllRead}
                    style={{
                      fontSize: 11, fontWeight: 600, color: '#F47651',
                      background: 'none', border: 'none', cursor: 'pointer',
                      padding: '4px 8px', borderRadius: 8,
                      fontFamily: 'inherit',
                    }}
                  >
                    Mark all read
                  </button>
                )}
              </div>
            </div>

            {/* Notification list */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {notifs.length === 0 ? (
                <div style={{ padding: '40px 18px', textAlign: 'center', color: '#94A3B8', fontSize: 13 }}>
                  No notifications for this role
                </div>
              ) : (
                notifs.map(n => {
                  const isRead = read.has(n.id);
                  return (
                    <div
                      key={n.id}
                      onClick={() => handleNotifClick(n)}
                      style={{
                        display: 'flex', alignItems: 'flex-start', gap: 12,
                        padding: '13px 18px', cursor: n.route ? 'pointer' : 'default',
                        background: isRead ? '#fff' : '#FAFBFF',
                        borderBottom: '1px solid #F8FAFC',
                        transition: 'background 0.1s',
                      }}
                      onMouseEnter={e => { if (n.route) (e.currentTarget as HTMLDivElement).style.background = '#F8FAFC'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = isRead ? '#fff' : '#FAFBFF'; }}
                    >
                      {/* Type icon */}
                      <div style={{
                        width: 32, height: 32, borderRadius: 10, flexShrink: 0,
                        background: ICON_BG[n.type], color: ICON_COLOR[n.type],
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        marginTop: 1,
                      }}>
                        <TypeIcon type={n.type} />
                      </div>

                      {/* Text */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: 13, fontWeight: isRead ? 500 : 700,
                          color: isRead ? '#475569' : '#0F172A',
                          lineHeight: 1.35,
                        }}>
                          {n.title}
                        </div>
                        <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 3, lineHeight: 1.4 }}>
                          {n.sub}
                        </div>
                        <div style={{ fontSize: 10, color: '#CBD5E1', marginTop: 4 }}>{n.time}</div>
                      </div>

                      {/* Unread dot */}
                      {!isRead && (
                        <div style={{ width: 7, height: 7, borderRadius: '50%', background: DOT[n.type], flexShrink: 0, marginTop: 6 }} />
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Footer */}
            <div style={{ padding: '10px 18px', borderTop: '1px solid #F1F5F9', flexShrink: 0 }}>
              <div style={{ fontSize: 11, color: '#94A3B8', textAlign: 'center' }}>
                Showing notifications for <strong>{activeProfile.roleLabel}</strong>
                {activeProfile.plant ? ` · ${activeProfile.plant}` : ''}
              </div>
            </div>
          </div>
        )}

        {/* Profile switcher */}
        <ProfileSwitcher />
      </div>
    </div>
  );
}
