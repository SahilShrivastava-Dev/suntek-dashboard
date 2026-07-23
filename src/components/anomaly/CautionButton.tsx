import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { useAnomalies } from '../../contexts/AnomalyContext';
import { useRoleContext } from '../../contexts/RoleContext';
import { profileCanAccess } from '../../lib/profiles';
import { dropdownStyle } from '../../lib/uiPosition';
import type { Severity } from '../../lib/anomaly/types';

const ICON_BG: Record<Severity, string> = { urgent: '#FEE2E2', warning: '#FEF3C7', info: '#DBEAFE' };
const ICON_COLOR: Record<Severity, string> = { urgent: '#DC2626', warning: '#D97706', info: '#2563EB' };
const DOT: Record<Severity, string> = { urgent: '#DC2626', warning: '#D97706', info: '#2563EB' };

export function CautionButton() {
  const navigate = useNavigate();
  const { activeProfile } = useRoleContext();
  const { findings, criticalCount, urgentCount, loading } = useAnomalies();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        btnRef.current && !btnRef.current.contains(e.target as Node)
      ) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => { setOpen(false); }, [activeProfile.id]);

  // Close when the page scrolls behind the (fixed) panel.
  useEffect(() => {
    if (!open) return;
    const onScroll = () => setOpen(false);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [open]);

  // RBAC: only show the caution button if this role can reach the anomaly dashboard
  if (!profileCanAccess(activeProfile, '/dashboard/anomalies')) return null;

  const badgeColor = urgentCount > 0 ? '#DC2626' : '#D97706';

  function formatAge(ts: string) {
    const diff = Date.now() - new Date(ts).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }

  return (
    <>
      <button
        ref={btnRef}
        title="Anomaly detection"
        className={`w-10 h-10 rounded-[10px] border flex items-center justify-center relative ${open ? 'bg-slate-900 border-slate-900' : 'bg-white border-slate-200 hover:bg-slate-50'}`}
        onClick={() => setOpen(v => !v)}
      >
        <AlertTriangle size={16} color={open ? '#fff' : (criticalCount > 0 ? badgeColor : '#64748B')} strokeWidth={2} />
        {criticalCount > 0 && (
          <span style={{
            position: 'absolute', top: -2, right: -2,
            minWidth: 16, height: 16, padding: '0 3px', borderRadius: 999,
            background: badgeColor, border: '2px solid #fff',
            fontSize: 9, fontWeight: 700, color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {criticalCount > 9 ? '9+' : criticalCount}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          style={{
            ...dropdownStyle(btnRef.current, 380, 540),
            background: '#fff', border: '1px solid #E2E8F0',
            borderRadius: 20, boxShadow: '0 12px 40px rgba(0,0,0,0.12)',
            zIndex: 200, display: 'flex', flexDirection: 'column', overflow: 'hidden',
          }}
        >
          <div style={{ padding: '16px 18px 12px', borderBottom: '1px solid #F1F5F9', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#0F172A' }}>Anomaly detection</div>
                <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 1 }}>
                  {urgentCount} urgent · {criticalCount} flagged
                </div>
              </div>
              <button
                onClick={() => { navigate('/dashboard/anomalies'); setOpen(false); }}
                style={{
                  fontSize: 11, fontWeight: 600, color: '#D97706',
                  background: 'none', border: 'none', cursor: 'pointer',
                  padding: '4px 8px', borderRadius: 8, fontFamily: 'inherit',
                }}
              >
                Open dashboard →
              </button>
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {loading ? (
              <div style={{ padding: '32px 18px', textAlign: 'center', color: '#94A3B8', fontSize: 12 }}>
                Scanning live data…
              </div>
            ) : findings.length === 0 ? (
              <div style={{ padding: '40px 18px', textAlign: 'center', color: '#94A3B8', fontSize: 13 }}>
                No anomalies detected · all clear
              </div>
            ) : (
              findings.map(f => (
                <div
                  key={f.id}
                  onClick={() => { navigate(f.route); setOpen(false); }}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 12,
                    padding: '13px 18px', cursor: 'pointer',
                    borderBottom: '1px solid #F8FAFC', transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#F8FAFC')}
                  onMouseLeave={e => (e.currentTarget.style.background = '#fff')}
                >
                  <div style={{
                    width: 32, height: 32, borderRadius: 10, flexShrink: 0,
                    background: ICON_BG[f.severity], color: ICON_COLOR[f.severity],
                    display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 1,
                  }}>
                    <AlertTriangle size={14} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#0F172A', lineHeight: 1.35 }}>{f.title}</div>
                    <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 3, lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{f.body}</div>
                    <div style={{ fontSize: 10, color: '#CBD5E1', marginTop: 2 }}>
                      {f.anomaly_type} · {formatAge(f.fired_at)}
                    </div>
                  </div>
                  <div style={{ width: 7, height: 7, borderRadius: '50%', background: DOT[f.severity], flexShrink: 0, marginTop: 6 }} />
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </>
  );
}
