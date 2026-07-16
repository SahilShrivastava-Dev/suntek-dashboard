import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useRoleContext } from '../../contexts/RoleContext';
import { statusBadge } from '../dashboard/purchase/maintenance/shared';
import { matchAsset } from '../../lib/far/assets';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, PieChart, Pie, Cell,
} from 'recharts';
import type { Database } from '../../lib/database.types';

type AssetRow = Database['public']['Tables']['fixed_assets']['Row'] & { plants?: { name: string | null } | null };
type TicketRow = Database['public']['Tables']['maintenance_tickets']['Row'] & { plants?: { name: string | null } | null };
type ScheduleRow = Database['public']['Tables']['maintenance_schedules']['Row'];
type PartRow = Database['public']['Tables']['maintenance_store_requests']['Row'];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fmtDate = (d: string | null | undefined) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const fmtDateTime = (d: string | null | undefined) => d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

function Screen({ emoji, title, sub }: { emoji: string; title: string; sub: string }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: '#F8FAFC' }}>
      <div style={{ textAlign: 'center', maxWidth: 380 }}>
        <div style={{ fontSize: 44, marginBottom: 12 }}>{emoji}</div>
        <div style={{ fontSize: 18, fontWeight: 800, color: '#0F172A' }}>{title}</div>
        <div style={{ fontSize: 13, color: '#64748B', marginTop: 6, lineHeight: 1.5 }}>{sub}</div>
      </div>
    </div>
  );
}

/**
 * Standalone, mobile-first Asset Profile — the QR landing page. Aggregates a
 * single fixed asset's details + full maintenance history + operational stats
 * from the existing tables (no duplicate storage). Reached by scanning the asset
 * QR (`/asset/:key` where key is the qr_token) or internally by asset id.
 * Behind RequireLogin (route) + the `view_asset_profile` capability.
 */
export function AssetProfile() {
  const { key = '' } = useParams();
  const navigate = useNavigate();
  const { can, authResolved } = useRoleContext();

  const [loading, setLoading] = useState(true);
  const [asset, setAsset] = useState<AssetRow | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [schedules, setSchedules] = useState<ScheduleRow[]>([]);
  const [parts, setParts] = useState<PartRow[]>([]);

  const allowed = can('view_asset_profile');
  const showAnalytics = can('view_asset_analytics');

  useEffect(() => {
    if (!authResolved || !allowed) return;
    let cancelled = false;
    (async () => {
      setLoading(true); setNotFound(false);
      // Resolve by qr_token first (what the QR encodes), then by id (internal links).
      let a: AssetRow | null = null;
      const { data: byToken } = await supabase.from('fixed_assets').select('*, plants(name)').eq('qr_token', key).limit(1).returns<AssetRow[]>();
      a = byToken?.[0] ?? null;
      if (!a && UUID_RE.test(key)) {
        const { data: byId } = await supabase.from('fixed_assets').select('*, plants(name)').eq('id', key).limit(1).returns<AssetRow[]>();
        a = byId?.[0] ?? null;
      }
      if (cancelled) return;
      if (!a) { setNotFound(true); setLoading(false); return; }
      setAsset(a);

      // ── Aggregate history ──────────────────────────────────────────────
      // 1) reliable FK link (all ticket types raised after the source-fix)
      const { data: fk } = await supabase.from('maintenance_tickets').select('*, plants(name)').eq('far_asset_id', a.id).returns<TicketRow[]>();
      // 2) periodic schedules for this asset → legacy periodic tickets + next-due
      const { data: scheds } = await supabase.from('maintenance_schedules').select('*').eq('far_asset_id', a.id).returns<ScheduleRow[]>();
      const schedIds = (scheds || []).map(s => s.id);
      let periodicLegacy: TicketRow[] = [];
      if (schedIds.length) {
        const { data } = await supabase.from('maintenance_tickets').select('*, plants(name)').in('schedule_id', schedIds).returns<TicketRow[]>();
        periodicLegacy = data || [];
      }
      // 3) legacy emergency tickets — no FK; match by normalized mark only (mark-exact,
      //    never fuzzy name, to avoid over-attributing same-type tickets), scoped by plant.
      let emergencyLegacy: TicketRow[] = [];
      if (a.identification_mark) {
        let q = supabase.from('maintenance_tickets').select('*, plants(name)').eq('type', 'emergency').is('far_asset_id', null);
        if (a.plant_id) q = q.eq('plant_id', a.plant_id);
        const { data } = await q.limit(1000).returns<TicketRow[]>();
        const one = [{ id: a.id, name: a.name, identification_mark: a.identification_mark }];
        emergencyLegacy = (data || []).filter(t => {
          const m = matchAsset(t.equipment || '', one);
          return !!m && m.via === 'mark' && m.asset.id === a!.id;
        });
      }
      if (cancelled) return;
      const map = new Map<string, TicketRow>();
      for (const t of [...(fk || []), ...periodicLegacy, ...emergencyLegacy]) map.set(t.id, t);
      const merged = [...map.values()].sort((x, y) => (y.created_at || '').localeCompare(x.created_at || ''));
      setTickets(merged);
      setSchedules(scheds || []);

      const ticketIds = merged.map(t => t.id);
      if (ticketIds.length) {
        const { data: pr } = await supabase.from('maintenance_store_requests').select('*').in('ticket_id', ticketIds).returns<PartRow[]>();
        if (!cancelled) setParts(pr || []);
      } else { setParts([]); }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [key, authResolved, allowed]);

  // ── Derived stats ──────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const emergency = tickets.filter(t => t.type === 'emergency').length;
    const periodic = tickets.filter(t => t.type === 'periodic').length;
    const dates = tickets.map(t => t.closed_at || t.created_at).filter(Boolean).map(d => new Date(d as string).getTime()).sort((a, b) => a - b);
    const last = dates.length ? new Date(dates[dates.length - 1]).toISOString() : null;
    let avgDays: number | null = null;
    if (dates.length >= 2) {
      let sum = 0; for (let i = 1; i < dates.length; i++) sum += (dates[i] - dates[i - 1]);
      avgDays = Math.round(sum / (dates.length - 1) / 86400000);
    }
    const nextDue = (schedules.filter(s => s.is_active && s.next_due_at).map(s => s.next_due_at as string).sort())[0] || null;
    const openCount = tickets.filter(t => t.status && t.status !== 'closed').length;
    return { total: tickets.length, emergency, periodic, last, avgDays, nextDue, openCount };
  }, [tickets, schedules]);

  const perMonth = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of tickets) {
      const d = new Date(t.created_at);
      if (isNaN(d.getTime())) continue;
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      m.set(k, (m.get(k) || 0) + 1);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-12).map(([k, count]) => {
      const [y, mo] = k.split('-');
      return { month: new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }), count };
    });
  }, [tickets]);

  const typeSplit = useMemo(() => [
    { name: 'Emergency', value: stats.emergency, color: '#DC2626' },
    { name: 'Preventive', value: stats.periodic, color: '#2563EB' },
  ].filter(d => d.value > 0), [stats]);

  // ── Guards ─────────────────────────────────────────────────────────────
  if (!authResolved) return <Screen emoji="⏳" title="Loading…" sub="Checking your access." />;
  if (!allowed) return <Screen emoji="🔒" title="Access restricted" sub="You don't have permission to view asset profiles. Ask an administrator to grant you the 'View asset profile' permission." />;
  if (loading) return <Screen emoji="⏳" title="Loading asset…" sub="Fetching the digital profile." />;
  if (notFound || !asset) return <Screen emoji="🏷️" title="QR not recognised" sub="This QR code isn't valid or has been regenerated. Ask an administrator for a fresh code." />;

  const detail = (k: string, v: React.ReactNode) => (
    <div style={{ padding: '8px 0', borderBottom: '1px solid #F1F5F9', display: 'flex', justifyContent: 'space-between', gap: 12 }}>
      <span style={{ fontSize: 12, color: '#94A3B8', fontWeight: 600 }}>{k}</span>
      <span style={{ fontSize: 13, color: '#0F172A', fontWeight: 600, textAlign: 'right' }}>{v || '—'}</span>
    </div>
  );

  const kpi = (label: string, value: React.ReactNode, color: string, bg: string) => (
    <div style={{ border: '1px solid #E2E8F0', borderRadius: 12, padding: '12px 14px', background: bg, flex: '1 1 120px', minWidth: 120 }}>
      <div style={{ fontSize: 22, fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 10.5, color: '#64748B', marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>{label}</div>
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', background: '#F8FAFC' }}>
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '20px 16px 48px' }}>
        {/* Header */}
        <div style={{ background: '#0F172A', borderRadius: 20, padding: '20px 20px 22px', color: '#fff', marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
            {asset.photo_url
              ? <img src={asset.photo_url} alt="" style={{ width: 56, height: 56, borderRadius: 14, objectFit: 'cover', flexShrink: 0 }} />
              : <div style={{ width: 56, height: 56, borderRadius: 14, background: '#1E293B', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, flexShrink: 0 }}>🏭</div>}
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 20, fontWeight: 800, lineHeight: 1.15 }}>{asset.name}</div>
              <div style={{ fontSize: 13, color: '#CBD5E1', marginTop: 2 }}>
                {asset.identification_mark ? <strong style={{ color: '#fff' }}>{asset.identification_mark}</strong> : null}
                {asset.plants?.name ? `${asset.identification_mark ? ' · ' : ''}${asset.plants.name}` : ''}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 999, background: stats.openCount ? '#FEF3C7' : '#DCFCE7', color: stats.openCount ? '#B45309' : '#16A34A' }}>
              {stats.openCount ? '🔧 Under maintenance' : '✓ Operational'}
            </span>
            <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 999, background: '#1E293B', color: '#CBD5E1' }}>Asset #{asset.id.slice(0, 8)}</span>
          </div>
        </div>

        {/* Asset details */}
        <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 16, padding: '4px 16px 12px', marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#0F172A', padding: '12px 0 4px' }}>Asset details</div>
          {detail('Equipment type', asset.name)}
          {detail('Identification mark', asset.identification_mark)}
          {detail('Make / manufacturer', asset.make)}
          {detail('Model', asset.model)}
          {detail('Serial no', asset.serial_no)}
          {detail('Capacity', asset.capacity)}
          {detail('Year', asset.year)}
          {detail('Purchase date', fmtDate(asset.purchase_date))}
          {detail('Account head', asset.account_head)}
          {detail('Value', asset.value != null ? `₹ ${Number(asset.value).toLocaleString('en-IN')}` : '—')}
          {detail('Plant', asset.plants?.name)}
        </div>

        {/* Repair statistics */}
        <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 16, padding: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#0F172A', marginBottom: 10 }}>Repair statistics</div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {kpi('Total maintenance', stats.total, '#0F172A', '#F8FAFC')}
            {kpi('Emergency', stats.emergency, '#DC2626', '#FEF2F2')}
            {kpi('Preventive', stats.periodic, '#2563EB', '#EFF6FF')}
            {kpi('Avg gap (days)', stats.avgDays ?? '—', '#7C3AED', '#F5F3FF')}
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
            {kpi('Last maintenance', fmtDate(stats.last), '#16A34A', '#F0FDF4')}
            {kpi('Next scheduled', fmtDate(stats.nextDue), '#D97706', '#FFFBEB')}
            {kpi('Parts requested', parts.length, '#0F172A', '#F8FAFC')}
          </div>
        </div>

        {/* Charts (analytics permission) */}
        {showAnalytics && stats.total > 0 && (
          <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 16, padding: 16, marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#0F172A', marginBottom: 10 }}>Trends</div>
            <div style={{ fontSize: 11, color: '#94A3B8', marginBottom: 6 }}>Maintenance per month</div>
            <div style={{ width: '100%', height: 180 }}>
              <ResponsiveContainer>
                <BarChart data={perMonth} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 10 }} />
                  <Bar dataKey="count" fill="#F47651" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            {typeSplit.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 8 }}>
                <div style={{ width: 130, height: 130 }}>
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie data={typeSplit} dataKey="value" nameKey="name" innerRadius={34} outerRadius={58} paddingAngle={2}>
                        {typeSplit.map((d) => <Cell key={d.name} fill={d.color} />)}
                      </Pie>
                      <Tooltip contentStyle={{ fontSize: 12, borderRadius: 10 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div>
                  {typeSplit.map(d => (
                    <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#475569', marginBottom: 4 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 3, background: d.color }} /> {d.name} · <strong>{d.value}</strong>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Maintenance history */}
        <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 16, padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#0F172A', marginBottom: 10 }}>Maintenance history</div>
          {tickets.length === 0 ? (
            <div style={{ fontSize: 12.5, color: '#94A3B8', padding: '8px 0' }}>No maintenance records for this asset yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {tickets.map(t => (
                <div key={t.id} style={{ border: '1px solid #E2E8F0', borderRadius: 12, padding: '10px 12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <button
                      onClick={() => navigate(`/dashboard/purchase/maint?ticket=${t.id}`)}
                      style={{ fontSize: 12, fontWeight: 700, color: '#2563EB', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}
                    >
                      #{t.id.slice(0, 8)}
                    </button>
                    <span style={{ fontSize: 10.5, fontWeight: 700, padding: '1px 7px', borderRadius: 999, background: t.type === 'emergency' ? '#FEF2F2' : '#EFF6FF', color: t.type === 'emergency' ? '#DC2626' : '#2563EB' }}>
                      {t.type === 'emergency' ? 'Emergency' : 'Preventive'}
                    </span>
                    {statusBadge(t.status)}
                    <span style={{ fontSize: 11, color: '#94A3B8', marginLeft: 'auto' }}>{fmtDateTime(t.created_at)}</span>
                  </div>
                  <div style={{ fontSize: 13, color: '#0F172A', fontWeight: 600, marginTop: 6 }}>{t.title || t.equipment}</div>
                  {t.description && <div style={{ fontSize: 12, color: '#64748B', marginTop: 2, lineHeight: 1.4 }}>{t.description}</div>}
                  <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 4 }}>
                    {t.assigned_to || t.raised_by ? `By ${t.assigned_to || t.raised_by}` : ''}{t.closed_at ? ` · Closed ${fmtDate(t.closed_at)}` : ''}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ textAlign: 'center', fontSize: 11, color: '#CBD5E1', marginTop: 20 }}>Suntek · CaratSense · Asset profile</div>
      </div>
    </div>
  );
}
