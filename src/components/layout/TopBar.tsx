import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ProfileSwitcher } from './ProfileSwitcher';
import { RoleSwitchButton } from './RoleSwitchButton';
import { CautionButton } from '../anomaly/CautionButton';
import { useRoleContext } from '../../contexts/RoleContext';
import { useNotifications } from '../../contexts/NotificationsContext';
import type { AppNotification } from '../../contexts/NotificationsContext';

type NType = 'critical' | 'urgent' | 'warning' | 'info';

// ── Colour helpers (also used as the blacklist-severity scale) ─────────────────
// critical = deep red, urgent/high = red, warning/medium = amber, info/low = blue

const DOT: Record<NType, string>   = { critical: '#7F1D1D', urgent: '#DC2626', warning: '#D97706', info: '#2563EB' };
const ICON_BG: Record<NType, string> = { critical: '#FECACA', urgent: '#FEE2E2', warning: '#FEF3C7', info: '#DBEAFE' };
const ICON_COLOR: Record<NType, string> = { critical: '#7F1D1D', urgent: '#DC2626', warning: '#D97706', info: '#2563EB' };

function TypeIcon({ type }: { type: NType }) {
  if (type === 'urgent' || type === 'critical') return (
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
  const { notifications, unreadCount, markRead, markAllRead, clearAll, tableReady } = useNotifications();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const btnRef   = useRef<HTMLButtonElement>(null);

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

  // Close on profile change
  useEffect(() => { setOpen(false); }, [activeProfile.id]);

  function handleNotifClick(n: AppNotification) {
    markRead(n.id);
    if (n.route) { navigate(n.route); setOpen(false); }
  }

  function formatAge(ts: string) {
    const diff = Date.now() - new Date(ts).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }

  const roleId = activeProfile?.id ?? 'admin';
  const unread = unreadCount;

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

        {/* Anomaly caution button (renders only for roles with anomaly access) */}
        <CautionButton />

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
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  {unread > 0 && (
                    <button
                      onClick={markAllRead}
                      style={{
                        fontSize: 11, fontWeight: 600, color: '#F47651',
                        background: 'none', border: 'none', cursor: 'pointer',
                        padding: '4px 8px', borderRadius: 8, fontFamily: 'inherit',
                      }}
                    >
                      Mark all read
                    </button>
                  )}
                  {notifications.length > 0 && (
                    <button
                      onClick={clearAll}
                      title="Remove all notifications from your view"
                      style={{
                        fontSize: 11, fontWeight: 600, color: '#94A3B8',
                        background: 'none', border: 'none', cursor: 'pointer',
                        padding: '4px 8px', borderRadius: 8, fontFamily: 'inherit',
                      }}
                    >
                      Clear all
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Notification list */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {!tableReady ? (
                <div style={{ padding: '32px 18px', textAlign: 'center', color: '#94A3B8', fontSize: 12 }}>
                  <div style={{ marginBottom: 6 }}>Notification table not set up yet.</div>
                  <div style={{ fontSize: 11, color: '#CBD5E1' }}>Run the SQL migration in Supabase to enable live notifications.</div>
                </div>
              ) : notifications.length === 0 ? (
                <div style={{ padding: '40px 18px', textAlign: 'center', color: '#94A3B8', fontSize: 13 }}>
                  No notifications yet
                </div>
              ) : (
                notifications.map(n => {
                  const isRead = n.read_by?.includes(roleId);
                  const nType = (n.type as NType) || 'info';
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
                      <div style={{
                        width: 32, height: 32, borderRadius: 10, flexShrink: 0,
                        background: ICON_BG[nType], color: ICON_COLOR[nType],
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        marginTop: 1,
                      }}>
                        <TypeIcon type={nType} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: isRead ? 500 : 700, color: isRead ? '#475569' : '#0F172A', lineHeight: 1.35 }}>
                          {n.title}
                        </div>
                        {n.body && (
                          <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 3, lineHeight: 1.4 }}>{n.body}</div>
                        )}
                        {n.actor_name && (
                          <div style={{ fontSize: 10, color: '#CBD5E1', marginTop: 2 }}>by {n.actor_name}</div>
                        )}
                        <div style={{ fontSize: 10, color: '#CBD5E1', marginTop: 2 }}>{formatAge(n.created_at)}</div>
                      </div>
                      {!isRead && (
                        <div style={{ width: 7, height: 7, borderRadius: '50%', background: DOT[nType], flexShrink: 0, marginTop: 6 }} />
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Footer */}
            <div style={{ padding: '10px 18px', borderTop: '1px solid #F1F5F9', flexShrink: 0 }}>
              <div style={{ fontSize: 11, color: '#94A3B8', textAlign: 'center' }}>
                Live · <strong>{activeProfile.roleLabel}</strong>
                {activeProfile.plant ? ` · ${activeProfile.plant}` : ''}
              </div>
            </div>
          </div>
        )}

        {/* Role preview switcher (admin only) — ⇅ icon, separate from the account menu */}
        <RoleSwitchButton />

        {/* Personal account menu (Settings · Sign out) */}
        <ProfileSwitcher />
      </div>
    </div>
  );
}
