import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { insertRows } from '../../lib/db';
import { useToast } from '../../components/ui/toast';
import { useRoleContext } from '../../contexts/RoleContext';
import { usePlantScope } from '../../contexts/PlantScopeContext';

/**
 * Night-duty scheduler — shown to users with the `allocate_night_duty` capability
 * (e.g. a unit head). They pick their subordinates (technicians/people in their
 * plant, tier below them), pick dates on a calendar (or a repeat pattern for
 * rotation), and schedule night duty. Each date × person = one night_duty row.
 */

type Acct = { id: string; name: string; role_id: string | null; plant_id: string | null; is_active: boolean };
type Duty = {
  id: string; technician_id: string; duty_date: string; status: string;
  checked_in_at: string | null; plant_id: string | null;
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayIso = () => iso(new Date());

const STATUS_CFG: Record<string, { label: string; bg: string; color: string }> = {
  scheduled:  { label: 'Scheduled',  bg: '#EFF6FF', color: '#2563EB' },
  checked_in: { label: 'Checked in', bg: '#DCFCE7', color: '#16A34A' },
  completed:  { label: 'Completed',  bg: '#F1F5F9', color: '#64748B' },
  missed:     { label: 'Missed',     bg: '#FEF2F2', color: '#DC2626' },
};

export function NightDutyScheduler() {
  const toast = useToast();
  const { activeProfile, roles } = useRoleContext();
  const { plantIds, isGlobal, plants } = usePlantScope();

  const [myAccountId, setMyAccountId] = useState<string | null>(null);
  const [tiers, setTiers] = useState<Record<string, number>>({});
  const [accts, setAccts] = useState<Acct[]>([]);
  const [duties, setDuties] = useState<Duty[]>([]);
  const [loading, setLoading] = useState(true);

  // Scheduling form
  const [monthCursor, setMonthCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [selectedDates, setSelectedDates] = useState<string[]>([]);
  const [selectedTechIds, setSelectedTechIds] = useState<string[]>([]);
  const [repeatDays, setRepeatDays] = useState<number[]>([]);
  const [repeatUntil, setRepeatUntil] = useState('');
  const [saving, setSaving] = useState(false);
  const [techSearch, setTechSearch] = useState('');
  const [expandedTech, setExpandedTech] = useState<Set<string>>(new Set());
  // The scheduling form lives in a modal so the page shows only the report by default.
  const [schedulerOpen, setSchedulerOpen] = useState(false);

  const roleTier = useMemo(() => {
    const m: Record<string, string> = {};
    for (const r of roles) m[r.id] = r.level;
    return m;
  }, [roles]);
  const roleLabel = useMemo(() => Object.fromEntries(roles.map(r => [r.id, r.label])), [roles]);

  const myRank = tiers[activeProfile.role] ?? Number.MAX_SAFE_INTEGER;

  const load = useCallback(async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    let acctId: string | null = null;
    if (user?.id) {
      const { data: me } = await supabase.from('user_accounts').select('id').eq('auth_user_id', user.id).limit(1).returns<{ id: string }[]>();
      acctId = me?.[0]?.id ?? null;
    }
    const [{ data: tierRows }, { data: acctRows }, { data: dutyRows }] = await Promise.all([
      supabase.from('tiers').select('id, rank').returns<{ id: string; rank: number }[]>(),
      supabase.from('user_accounts').select('id, name, role_id, plant_id, is_active').returns<Acct[]>(),
      supabase.from('night_duty').select('id, technician_id, duty_date, status, checked_in_at, plant_id').gte('duty_date', todayIso()).order('duty_date').returns<Duty[]>(),
    ]);
    setMyAccountId(acctId);
    setTiers(Object.fromEntries((tierRows ?? []).map(t => [t.id, t.rank])));
    setAccts(acctRows ?? []);
    setDuties(dutyRows ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Subordinates = active users in my plant(s), tier BELOW me, not me.
  const subordinates = useMemo(() => accts.filter(a => {
    if (!a.is_active || a.id === myAccountId) return false;
    if (!isGlobal && !(a.plant_id && plantIds.includes(a.plant_id))) return false;
    const rank = a.role_id ? (tiers[roleTier[a.role_id]] ?? 0) : 0;
    return rank < myRank;
  }), [accts, myAccountId, isGlobal, plantIds, tiers, roleTier, myRank]);

  const acctName = useMemo(() => Object.fromEntries(accts.map(a => [a.id, a.name])), [accts]);
  const plantName = useMemo(() => Object.fromEntries(plants.map(p => [p.id, p.name])), [plants]);

  // Search subordinates by name / role / level.
  const filteredSubs = useMemo(() => {
    const q = techSearch.trim().toLowerCase();
    if (!q) return subordinates;
    return subordinates.filter(s => {
      const rl = (s.role_id ? roleLabel[s.role_id] : '') || '';
      const lv = (s.role_id ? roleTier[s.role_id] : '') || '';
      return s.name.toLowerCase().includes(q) || rl.toLowerCase().includes(q) || lv.toLowerCase().includes(q);
    });
  }, [subordinates, techSearch, roleLabel, roleTier]);

  // Night-duty report stats (from the loaded upcoming/checked-in duties).
  const report = useMemo(() => {
    const t = todayIso();
    return {
      tonight: duties.filter(d => d.duty_date === t).length,
      scheduled: duties.filter(d => d.status === 'scheduled').length,
      checkedIn: duties.filter(d => d.status === 'checked_in').length,
      missed: duties.filter(d => d.status === 'missed').length,
    };
  }, [duties]);

  function toggleDate(d: string) {
    setSelectedDates(s => s.includes(d) ? s.filter(x => x !== d) : [...s, d]);
  }
  function toggleTech(id: string) {
    setSelectedTechIds(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  }

  // "Repeat" helper: add every matching weekday from today..until into selectedDates.
  function applyRepeat() {
    if (!repeatDays.length || !repeatUntil) { toast.error('Pick weekday(s) and an end date'); return; }
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const end = new Date(repeatUntil + 'T00:00:00');
    if (end < start) { toast.error('End date is in the past'); return; }
    const add: string[] = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      if (repeatDays.includes(d.getDay())) add.push(iso(d));
    }
    setSelectedDates(s => [...new Set([...s, ...add])]);
    toast.success(`Added ${add.length} date${add.length === 1 ? '' : 's'}`);
  }

  async function schedule() {
    if (saving) return;
    if (!selectedTechIds.length) { toast.error('Select at least one person'); return; }
    if (!selectedDates.length) { toast.error('Select at least one date'); return; }
    setSaving(true);
    try {
      const group = (crypto as { randomUUID?: () => string }).randomUUID?.() ?? null;
      const rows = [];
      for (const techId of selectedTechIds) {
        const tech = accts.find(a => a.id === techId);
        for (const date of selectedDates) {
          rows.push({
            technician_id: techId,
            assigned_by: myAccountId,
            plant_id: tech?.plant_id ?? null,
            duty_date: date,
            status: 'scheduled',
            recurrence_group: group,
          });
        }
      }
      // Idempotent per (technician, date): skip clashes rather than error out.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.from('night_duty') as any)
        .upsert(rows, { onConflict: 'technician_id,duty_date', ignoreDuplicates: true });
      if (error) { toast.error(`Schedule failed: ${error.message}`); return; }
      toast.success(`Scheduled ${rows.length} duty slot${rows.length === 1 ? '' : 's'}`);
      setSelectedDates([]); setSelectedTechIds([]); setRepeatDays([]); setRepeatUntil('');
      setSchedulerOpen(false); // close the modal on success — back to the report
      await load();
    } finally { setSaving(false); }
  }

  // Month grid
  const monthGrid = useMemo(() => {
    const y = monthCursor.getFullYear(), m = monthCursor.getMonth();
    const first = new Date(y, m, 1);
    const startPad = first.getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const cells: (string | null)[] = [];
    for (let i = 0; i < startPad; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(iso(new Date(y, m, d)));
    return cells;
  }, [monthCursor]);

  // Upcoming duties grouped by date (used for the calendar dots).
  const dutiesByDate = useMemo(() => {
    const m: Record<string, Duty[]> = {};
    for (const d of duties) (m[d.duty_date] ??= []).push(d);
    return m;
  }, [duties]);

  // Grouped by PERSON for the assignments list — one collapsible row each, so it
  // stays compact with many technicians.
  const dutiesByTech = useMemo(() => {
    const m: Record<string, Duty[]> = {};
    for (const d of duties) (m[d.technician_id] ??= []).push(d);
    for (const k in m) m[k].sort((a, b) => a.duty_date.localeCompare(b.duty_date));
    return m;
  }, [duties]);
  const toggleTechRow = (id: string) => setExpandedTech(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const today = todayIso();

  return (
    <div className="card p-5 mb-5">
      {/* Header + top-right action — the scheduling form opens in a modal */}
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <div className="text-base font-bold mb-1">🌙 Night duty</div>
          <div className="text-xs text-slate-500">Assign your team onto night-duty shifts. Rotate by scheduling different people on different nights.</div>
        </div>
        <button
          onClick={() => setSchedulerOpen(true)}
          className="btn-accent pill"
          style={{ padding: '9px 16px', fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap', cursor: 'pointer', flexShrink: 0 }}
        >
          + Schedule Duty
        </button>
      </div>

      {/* Report — always visible, even when empty */}
      <div>
        <div className="text-sm font-bold mb-2">Night duty report</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
          {[
            { label: 'On duty tonight', value: report.tonight, color: '#2563EB', bg: '#EFF6FF' },
            { label: 'Scheduled ahead', value: report.scheduled, color: '#64748B', bg: '#F8FAFC' },
            { label: 'Checked in', value: report.checkedIn, color: '#16A34A', bg: '#DCFCE7' },
            { label: 'Missed', value: report.missed, color: '#DC2626', bg: '#FEF2F2' },
          ].map(s => (
            <div key={s.label} style={{ border: '1px solid #E2E8F0', borderRadius: 10, padding: '12px 14px', background: s.bg }}>
              <div style={{ fontSize: 26, fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.value}</div>
              <div style={{ fontSize: 10.5, color: '#64748B', marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Upcoming assignments — one collapsible row per person. */}
      <div style={{ marginTop: 18 }}>
        <div className="text-sm font-bold mb-2">Upcoming assignments</div>
        {Object.keys(dutiesByTech).length === 0 && <div style={{ fontSize: 12, color: '#94A3B8' }}>No upcoming night duty scheduled.</div>}
        <div className="flex flex-col gap-2">
          {Object.entries(dutiesByTech).map(([techId, ds]) => {
            const open = expandedTech.has(techId);
            const checkedIn = ds.filter(d => d.status === 'checked_in').length;
            const nextDate = ds.find(d => d.status !== 'checked_in')?.duty_date ?? ds[0].duty_date;
            return (
              <div key={techId} style={{ border: '1px solid #E2E8F0', borderRadius: 10, overflow: 'hidden' }}>
                <button
                  onClick={() => toggleTechRow(techId)}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: open ? '#F8FAFC' : '#fff', border: 'none', cursor: 'pointer', textAlign: 'left' }}
                >
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#0F172A', flex: 1 }}>{acctName[techId] || 'Unknown'}</span>
                  <span className="badge" style={{ background: '#EEF2FF', color: '#4338CA', fontSize: 11 }}>{ds.length} night{ds.length === 1 ? '' : 's'}</span>
                  {checkedIn > 0 && <span className="badge" style={{ background: '#DCFCE7', color: '#16A34A', fontSize: 11 }}>{checkedIn} checked in</span>}
                  <span style={{ fontSize: 11, color: '#94A3B8' }}>next {new Date(nextDate + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</span>
                  <span style={{ fontSize: 11, color: '#94A3B8', width: 14, textAlign: 'center' }}>{open ? '▾' : '▸'}</span>
                </button>
                {open && (
                  <div style={{ padding: '4px 12px 12px', display: 'flex', flexWrap: 'wrap', gap: 6, borderTop: '1px solid #F1F5F9' }}>
                    {ds.map(d => {
                      const cfg = STATUS_CFG[d.status] || STATUS_CFG.scheduled;
                      return (
                        <span key={d.id} className="badge" style={{ background: cfg.bg, color: cfg.color, fontSize: 11, marginTop: 6 }}>
                          {new Date(d.duty_date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short' })} · {cfg.label}
                          {d.checked_in_at && ` · ${new Date(d.checked_in_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Scheduling modal ─────────────────────────────────────────────── */}
      {schedulerOpen && (
      <div
        className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
        style={{ animation: 'fadein 200ms ease' }}
        onClick={() => setSchedulerOpen(false)}
      >
      <div
        className="bg-white w-full max-w-4xl rounded-3xl shadow-2xl border border-slate-100 max-h-[88vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
      <div className="p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="text-base font-bold mb-1">🌙 Schedule night duty</div>
            <div className="text-xs text-slate-500">Assign your team onto night-duty shifts. Rotate by scheduling different people on different nights.</div>
          </div>
          <button
            onClick={() => setSchedulerOpen(false)}
            aria-label="Close"
            style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid #E2E8F0', background: '#fff', cursor: 'pointer', fontSize: 16, color: '#64748B', flexShrink: 0, lineHeight: 1 }}
          >
            ✕
          </button>
        </div>

      <div className="grid grid-cols-12 gap-5">
        {/* Calendar */}
        <div className="col-span-12 lg:col-span-7">
          <div className="flex items-center justify-between mb-2">
            <button onClick={() => setMonthCursor(c => new Date(c.getFullYear(), c.getMonth() - 1, 1))} style={navBtn}>‹</button>
            <div className="text-sm font-semibold">{monthCursor.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</div>
            <button onClick={() => setMonthCursor(c => new Date(c.getFullYear(), c.getMonth() + 1, 1))} style={navBtn}>›</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 4 }}>
            {WEEKDAYS.map(w => <div key={w} style={{ textAlign: 'center', fontSize: 10.5, color: '#94A3B8', fontWeight: 700, padding: '2px 0' }}>{w}</div>)}
            {monthGrid.map((d, i) => {
              if (!d) return <div key={i} />;
              const past = d < today;
              const on = selectedDates.includes(d);
              const has = (dutiesByDate[d]?.length ?? 0) > 0;
              return (
                <button
                  key={i}
                  disabled={past}
                  onClick={() => toggleDate(d)}
                  style={{
                    height: 38, borderRadius: 8, border: '1px solid ' + (on ? '#2563EB' : '#E2E8F0'),
                    background: on ? '#2563EB' : (d === today ? '#EFF6FF' : '#fff'),
                    color: on ? '#fff' : (past ? '#CBD5E1' : '#334155'),
                    cursor: past ? 'not-allowed' : 'pointer', fontSize: 12.5, fontWeight: 600, position: 'relative',
                  }}
                >
                  {Number(d.slice(-2))}
                  {has && <span style={{ position: 'absolute', bottom: 3, left: '50%', transform: 'translateX(-50%)', width: 4, height: 4, borderRadius: '50%', background: on ? '#fff' : '#16A34A' }} />}
                </button>
              );
            })}
          </div>

          {/* Repeat helper */}
          <div style={{ marginTop: 12, padding: 12, background: '#F8FAFC', borderRadius: 10, border: '1px solid #E2E8F0' }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: '#475569', marginBottom: 6 }}>Repeat (for rotation)</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
              {WEEKDAYS.map((w, idx) => {
                const on = repeatDays.includes(idx);
                return (
                  <button key={w} onClick={() => setRepeatDays(s => on ? s.filter(x => x !== idx) : [...s, idx])}
                    style={{ padding: '4px 8px', borderRadius: 8, border: '1px solid ' + (on ? '#2563EB' : '#E2E8F0'), background: on ? '#2563EB' : '#fff', color: on ? '#fff' : '#475569', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>{w}</button>
                );
              })}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 11.5, color: '#64748B' }}>until</span>
              <input type="date" value={repeatUntil} min={today} onChange={e => setRepeatUntil(e.target.value)}
                style={{ padding: '6px 10px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 12.5, fontFamily: 'inherit' }} />
              <button onClick={applyRepeat} style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #E2E8F0', background: '#fff', fontSize: 12, fontWeight: 600, color: '#475569', cursor: 'pointer' }}>Add dates</button>
            </div>
          </div>
        </div>

        {/* People + schedule */}
        <div className="col-span-12 lg:col-span-5">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: '#475569' }}>Who's on duty ({selectedTechIds.length} selected)</div>
            {selectedTechIds.length > 0 && <button onClick={() => setSelectedTechIds([])} style={{ fontSize: 10.5, color: '#64748B', border: 'none', background: 'none', cursor: 'pointer' }}>clear</button>}
          </div>
          <input
            type="text" value={techSearch} onChange={e => setTechSearch(e.target.value)}
            placeholder="Search by name, role or level…"
            style={{ width: '100%', padding: '7px 10px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 12.5, outline: 'none', fontFamily: 'inherit', marginBottom: 6 }}
          />
          <div style={{ maxHeight: 300, overflowY: 'auto', border: '1px solid #E2E8F0', borderRadius: 10, padding: 4 }}>
            {loading && <div style={{ fontSize: 12, color: '#94A3B8', padding: 8 }}>Loading…</div>}
            {!loading && subordinates.length === 0 && <div style={{ fontSize: 12, color: '#94A3B8', padding: 8 }}>No team members beneath you in your plant.</div>}
            {!loading && subordinates.length > 0 && filteredSubs.length === 0 && <div style={{ fontSize: 12, color: '#94A3B8', padding: 8 }}>No match for "{techSearch}".</div>}
            {filteredSubs.map(s => {
              const on = selectedTechIds.includes(s.id);
              const lvl = s.role_id ? roleTier[s.role_id] : '';
              return (
                <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: '#334155', cursor: 'pointer', padding: '6px 8px', borderRadius: 8, background: on ? '#EFF6FF' : 'transparent' }}>
                  <input type="checkbox" checked={on} onChange={() => toggleTech(s.id)} />
                  <span style={{ flex: 1, fontWeight: 600 }}>{s.name}</span>
                  <span style={{ fontSize: 10.5, color: '#64748B' }}>{s.role_id ? roleLabel[s.role_id] : ''}</span>
                  {lvl && <span className="badge" style={{ fontSize: 9.5, background: '#F1F5F9', color: '#64748B', padding: '1px 5px' }}>{lvl}</span>}
                  <span style={{ fontSize: 10, color: '#CBD5E1' }}>{s.plant_id ? plantName[s.plant_id] : ''}</span>
                </label>
              );
            })}
          </div>
          <button onClick={schedule} disabled={saving} className="btn-accent pill" style={{ width: '100%', marginTop: 12, padding: '10px 0', fontWeight: 700, fontSize: 13, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Scheduling…' : `Schedule ${selectedTechIds.length}× ${selectedDates.length} night${selectedDates.length === 1 ? '' : 's'}`}
          </button>
          <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 4, textAlign: 'center' }}>{selectedTechIds.length} people × {selectedDates.length} dates</div>
        </div>
      </div>
      </div>
      </div>
      </div>
      )}
    </div>
  );
}

const navBtn: React.CSSProperties = { width: 28, height: 28, borderRadius: 8, border: '1px solid #E2E8F0', background: '#fff', cursor: 'pointer', fontSize: 16, color: '#475569' };
