import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { insertRows, updateRows } from '../../lib/db';
import { createLogin, updateLogin } from '../../lib/adminUsers';
import { useMentionNotifier } from '../../lib/mentions';
import { useBlacklistGuard } from '../../lib/blacklist/guard';
import { MOCK_PROFILES } from '../../lib/profiles';
import { useRoleContext } from '../../contexts/RoleContext';
import { logUserAccountEvent, LANGUAGE_OPTIONS } from '../../lib/userEvents';
import { SlidePanel, PanelField, PanelInput, PanelSelect, PanelTextarea, PanelRow, PanelDivider, PanelFooter } from '../../components/SlidePanel';
import { useToast } from '../../components/ui/toast';

interface UserEvent {
  id: string;
  action: string;
  details: string | null;
  actor_name: string | null;
  actor_role: string | null;
  created_at: string;
}

/** A user row for display — a user_accounts row (+ plants join) or a built-in system profile. */
interface DisplayUser {
  id: string;
  name: string;
  mobile: string | null;
  whatsapp: string | null;
  email: string | null;
  role_id: string | null;
  role_label: string | null;
  plant_id?: string | null;
  plant_name: string | null;
  plants?: { name: string | null } | null;
  designation: string | null;
  access_note: string | null;
  is_active: boolean;
  created_at: string | null;
  auth_user_id?: string | null;
  login_enabled?: boolean | null;
  preferred_language?: string | null;
  _isSystem?: boolean;
}

// ── Role options ──────────────────────────────────────────────────────────────

const ROLE_OPTIONS = [
  { id: 'admin',               label: 'Owner · Admin',           level: 'L4' },
  { id: 'unit_head',           label: 'Unit Head',               level: 'L3' },
  { id: 'warehouse_manager',   label: 'Warehouse Dispatch',      level: 'L2' },
  { id: 'store_manager_maint', label: 'Store Manager · Maint',   level: 'L2' },
  { id: 'labour_manager',      label: 'Labour Manager',          level: 'L2' },
  { id: 'accountant_delhi',    label: 'Accountant · Delhi',      level: 'L2' },
  { id: 'accountant_other',    label: 'Accountant · Other',      level: 'L2' },
  { id: 'night_manager',       label: 'Night Manager',           level: 'L1' },
  { id: 'factory_operator',    label: 'Technical Team · Operator', level: 'L1' },
  { id: 'technician_shd',      label: 'Technician',              level: 'L1' },
];

const LEVEL_COLOR: Record<string, { bg: string; color: string }> = {
  L4: { bg: '#FFF7ED', color: '#EA580C' },
  L3: { bg: '#EFF6FF', color: '#2563EB' },
  L2: { bg: '#F0FDF4', color: '#16A34A' },
  L1: { bg: '#F5F3FF', color: '#7C3AED' },
};

const STATUS_CFG = {
  active:   { label: 'Active',   bg: '#DCFCE7', color: '#16A34A' },
  inactive: { label: 'Inactive', bg: '#F1F5F9', color: '#94A3B8' },
};

function formatDate(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

const BLANK_FORM = {
  name: '', mobile: '', email: '', whatsapp: '',
  role_id: 'night_manager', plant: '', designation: '',
  access_note: '', is_active: true,
  login_enabled: false, password: '',
  preferred_language: 'en',
};

// Built-in profiles derived from MOCK_PROFILES — always shown, cannot be deleted
const SYSTEM_USERS: DisplayUser[] = MOCK_PROFILES.map(p => ({
  id: p.id,
  name: p.name,
  mobile: null,
  whatsapp: null,
  email: null,
  role_id: p.id,
  role_label: p.roleLabel,
  plant_name: p.plant || null,
  plants: null,
  designation: null,
  access_note: p.accessNote || null,
  is_active: true,
  created_at: null,
  auth_user_id: null,
  login_enabled: false,
  preferred_language: 'en',
  _isSystem: true,
}));

// ── Component ─────────────────────────────────────────────────────────────────

export function UserManagement() {
  const toast = useToast();
  const notifyMentions = useMentionNotifier();
  const screenBlacklist = useBlacklistGuard();
  const { activeProfile } = useRoleContext();
  const [users, setUsers] = useState<DisplayUser[]>([]);
  const [plants, setPlants] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);

  const [showPanel, setShowPanel] = useState(false);
  const [editingUser, setEditingUser] = useState<DisplayUser | null>(null);
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState({ ...BLANK_FORM });

  // History panel — per-profile action log
  const [historyUser, setHistoryUser] = useState<DisplayUser | null>(null);
  const [historyEvents, setHistoryEvents] = useState<UserEvent[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  async function openHistory(u: DisplayUser) {
    setHistoryUser(u);
    setHistoryLoading(true);
    setHistoryEvents([]);
    const { data } = await supabase
      .from('user_account_events')
      .select('id, action, details, actor_name, actor_role, created_at')
      .eq('user_account_id', u.id)
      .order('created_at', { ascending: false })
      .returns<UserEvent[]>();
    setHistoryEvents(data || []);
    setHistoryLoading(false);
  }

  const actor = { actorName: activeProfile.name, actorRole: activeProfile.id };

  const [filterRole, setFilterRole] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [search, setSearch] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    const [{ data: usersData }, { data: plantsData }] = await Promise.all([
      supabase.from('user_accounts').select('*, plants(name)').order('created_at', { ascending: false }).returns<DisplayUser[]>(),
      supabase.from('plants').select('id, name').returns<{ id: string; name: string }[]>(),
    ]);
    // Merge: built-in profiles first, then any extra DB-only users
    const dbUsers: DisplayUser[] = usersData || [];
    const merged = [
      ...SYSTEM_USERS,
      ...dbUsers,
    ];
    setUsers(merged);
    if (plantsData?.length) setPlants(plantsData);
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const plantNames = plants.map(p => p.name);
  const total = users.length;
  const activeCount = users.filter(u => u.is_active).length;
  const roleBreakdown = ROLE_OPTIONS.map(r => ({
    ...r, count: users.filter(u => u.role_id === r.id).length,
  })).filter(r => r.count > 0);

  const filtered = users.filter(u => {
    if (filterRole !== 'all' && u.role_id !== filterRole) return false;
    if (filterStatus === 'active' && !u.is_active) return false;
    if (filterStatus === 'inactive' && u.is_active) return false;
    if (search) {
      const q = search.toLowerCase();
      return (u.name || '').toLowerCase().includes(q) ||
             (u.mobile || '').includes(q) ||
             (u.email || '').toLowerCase().includes(q) ||
             (u.designation || '').toLowerCase().includes(q);
    }
    return true;
  });

  function openAdd() {
    setEditingUser(null);
    setForm({ ...BLANK_FORM });
    setSaved(false);
    setShowPanel(true);
  }

  function openEdit(u: any) {
    if (u._isSystem) return;
    setEditingUser(u);
    setForm({
      name: u.name || '',
      mobile: u.mobile || '',
      email: u.email || '',
      whatsapp: u.whatsapp || '',
      role_id: u.role_id || 'night_manager',
      plant: u.plants?.name || u.plant_name || '',
      designation: u.designation || '',
      access_note: u.access_note || '',
      is_active: u.is_active ?? true,
      login_enabled: !!u.auth_user_id || !!u.login_enabled,
      password: '',
      preferred_language: u.preferred_language || 'en',
    });
    setSaved(false);
    setShowPanel(true);
  }

  async function handleSave() {
    if (!form.name.trim() || !form.mobile.trim()) return;

    const existingAuthId = editingUser?.auth_user_id || null;
    // A brand-new login is being provisioned when login is enabled but no auth
    // user is linked yet (new user, or enabling login on an existing directory row).
    const provisioningNewLogin = form.login_enabled && !existingAuthId;
    if (provisioningNewLogin) {
      if (!form.email.trim()) { toast.error('Login email is required to create an account'); return; }
      if (form.password.length < 8) { toast.error('Password must be at least 8 characters'); return; }
    }

    const plant = plants.find(p => p.name === form.plant);
    const email = form.email.trim() || null;
    const payload = {
      name: form.name.trim(),
      mobile: form.mobile.trim(),
      email,
      whatsapp: form.whatsapp.trim() || null,
      role_id: form.role_id,
      role_label: ROLE_OPTIONS.find(r => r.id === form.role_id)?.label || form.role_id,
      plant_id: plant?.id || null,
      plant_name: form.plant || null,
      designation: form.designation.trim() || null,
      access_note: form.access_note.trim() || null,
      is_active: form.is_active,
      preferred_language: form.preferred_language || 'en',
    };

    // 1) Save the directory row first (and capture its id for credential linking).
    let accountId = editingUser?.id || '';
    if (editingUser) {
      const { error } = await updateRows('user_accounts', payload).eq('id', editingUser.id);
      if (error) { toast.error(`Update failed: ${error.message}`); return; }
    } else {
      const { data, error } = await insertRows('user_accounts', payload).select('id').single();
      if (error) { toast.error(`Save failed: ${error.message}`); return; }
      accountId = data?.id || '';
    }

    // 2) Provision / update the login via the service_role edge function.
    if (form.login_enabled) {
      if (existingAuthId) {
        const { error } = await updateLogin({
          auth_user_id: existingAuthId,
          user_account_id: accountId,
          email: email || undefined,
          password: form.password || undefined, // blank = keep current password
          name: form.name.trim(),
          role_id: form.role_id,
          plant_id: plant?.id || null,
        });
        if (error) { toast.error(`Login update failed: ${error}`); return; }
      } else {
        const { error } = await createLogin({
          user_account_id: accountId,
          email: email!,
          password: form.password,
          name: form.name.trim(),
          role_id: form.role_id,
          plant_id: plant?.id || null,
        });
        if (error) { toast.error(`Login creation failed: ${error}`); return; }
      }
    }

    // Record the admin action in the profile history.
    if (editingUser) {
      const changed: string[] = [];
      if (form.name.trim() !== (editingUser.name || '')) changed.push('name');
      if (email !== (editingUser.email || null)) changed.push('email');
      if (form.mobile.trim() !== (editingUser.mobile || '')) changed.push('contact');
      if (form.role_id !== editingUser.role_id) changed.push('role');
      if ((form.preferred_language || 'en') !== (editingUser.preferred_language || 'en')) changed.push('language');
      if (form.login_enabled && form.password) changed.push('password reset');
      await logUserAccountEvent({
        userAccountId: accountId, targetName: form.name.trim(), targetEmail: email,
        action: form.login_enabled && form.password ? 'password_reset' : 'admin_update',
        details: changed.length ? `Admin updated: ${changed.join(', ')}` : 'Admin saved (no field changes)',
        ...actor,
      });
    } else {
      await logUserAccountEvent({
        userAccountId: accountId, targetName: form.name.trim(), targetEmail: email,
        action: 'created',
        details: `Created${form.login_enabled ? ' with login' : ' (directory only)'} · role ${ROLE_OPTIONS.find(r => r.id === form.role_id)?.label || form.role_id}`,
        ...actor,
      });
    }

    await notifyMentions(form.access_note, {
      entityType: 'user_account', entityId: editingUser?.id,
      entityLabel: `User · ${form.name.trim()}`, route: '/dashboard/users',
    });
    const hits = await screenBlacklist(
      [{ value: form.name, label: 'Name' }, { value: form.designation, label: 'Designation' }],
      { workflow: 'User Management', source: 'entry', entityLabel: `User · ${form.name.trim()}` },
    );
    if (hits.length) {
      const h = hits[0];
      toast.error(`⚠ "${h.candidate.value}" ≈ blacklisted ${h.entry.type} "${h.entry.name}" (${Math.round(h.score * 100)}%). Admin notified.`);
    }
    setSaved(true);
    await loadData();
    setTimeout(() => {
      setShowPanel(false);
      setSaved(false);
      setForm({ ...BLANK_FORM });
      setEditingUser(null);
    }, 1400);
  }

  async function toggleStatus(u: DisplayUser) {
    if (u._isSystem) return;
    await updateRows('user_accounts', { is_active: !u.is_active }).eq('id', u.id);
    await loadData();
  }

  const selectedRole = ROLE_OPTIONS.find(r => r.id === form.role_id);

  return (
    <>
      {/* KPI row */}
      <div className="grid grid-cols-12 gap-5 mb-5">
        <div className="col-span-12 lg:col-span-3 card p-5">
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">Total users</div>
          <div className="text-[28px] font-extrabold mt-1 num">{total}</div>
          <div className="text-[11px] text-slate-500 mt-1">all roles</div>
        </div>
        <div className="col-span-12 lg:col-span-3 card p-5">
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">Active</div>
          <div className="text-[28px] font-extrabold mt-1 num text-green-600">{activeCount}</div>
          <div className="text-[11px] text-slate-400 mt-1">{total - activeCount} inactive</div>
        </div>
        <div className="col-span-12 lg:col-span-6 card p-5">
          <div className="text-[11px] text-slate-500 uppercase tracking-wider mb-3">By role</div>
          <div className="flex flex-wrap gap-2">
            {roleBreakdown.length === 0 && <div className="text-[11px] text-slate-400">No users yet</div>}
            {roleBreakdown.map(r => {
              const lvl = LEVEL_COLOR[r.level] || { bg: '#F1F5F9', color: '#64748B' };
              return (
                <span key={r.id} className="badge" style={{ background: lvl.bg, color: lvl.color, fontSize: 10.5 }}>
                  {r.label} · {r.count}
                </span>
              );
            })}
          </div>
        </div>
      </div>

      {/* User table */}
      <div className="card p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div>
            <div className="text-base font-bold">User accounts</div>
            <div className="text-xs text-slate-500">All staff registered in CaratSense · manage roles and access</div>
          </div>
          <button className="btn-accent pill px-4 py-2 font-semibold text-sm" onClick={openAdd}>
            + Add user
          </button>
        </div>

        {/* Filters */}
        <div className="flex gap-3 mb-4 flex-wrap">
          <input
            type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search name, mobile, email…"
            style={{ padding: '8px 14px', borderRadius: 12, border: '1.5px solid #E2E8F0', fontSize: 13, outline: 'none', fontFamily: 'inherit', minWidth: 220 }}
          />
          <select value={filterRole} onChange={e => setFilterRole(e.target.value)}
            style={{ padding: '8px 14px', borderRadius: 12, border: '1.5px solid #E2E8F0', fontSize: 13, fontFamily: 'inherit', background: '#fff' }}>
            <option value="all">All roles</option>
            {ROLE_OPTIONS.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
            style={{ padding: '8px 14px', borderRadius: 12, border: '1.5px solid #E2E8F0', fontSize: 13, fontFamily: 'inherit', background: '#fff' }}>
            <option value="all">All status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>

        <div className="overflow-x-auto scroll-x">
          <table className="dt">
            <thead>
              <tr>
                <th>Name</th>
                <th>Mobile</th>
                <th>WhatsApp</th>
                <th>Email</th>
                <th>Role</th>
                <th>Level</th>
                <th>Plant</th>
                <th>Designation</th>
                <th>Status</th>
                <th>Added</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={11} className="text-center text-slate-400 py-6 text-sm">Loading…</td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={11} className="text-center text-slate-400 py-6 text-sm">
                  {total === 0 ? 'No users added yet — add the first one' : 'No users match filters'}
                </td></tr>
              )}
              {filtered.map(u => {
                const ro = ROLE_OPTIONS.find(r => r.id === u.role_id);
                const lvl = ro ? LEVEL_COLOR[ro.level] : { bg: '#F1F5F9', color: '#64748B' };
                const sc = u.is_active ? STATUS_CFG.active : STATUS_CFG.inactive;
                return (
                  <tr key={u.id}>
                    <td>
                      <div className="flex items-center gap-2">
                        <div className="font-semibold text-slate-800">{u.name}</div>
                        {u._isSystem && (
                          <span className="badge" style={{ background: '#F1F5F9', color: '#94A3B8', fontSize: 10, padding: '1px 6px' }}>built-in</span>
                        )}
                      </div>
                      {u.designation && <div className="text-[11px] text-slate-400">{u.designation}</div>}
                    </td>
                    <td>
                      {u.mobile
                        ? <a href={`tel:${u.mobile}`} className="text-slate-700 hover:text-blue-600 text-sm">{u.mobile}</a>
                        : <span className="text-slate-300 text-sm">—</span>}
                    </td>
                    <td className="text-slate-500 text-xs">{u.whatsapp || u.mobile || <span className="text-slate-300">—</span>}</td>
                    <td className="text-slate-500 text-xs">
                      <div className="flex items-center gap-1.5">
                        <span>{u.email || <span className="text-slate-300">—</span>}</span>
                        {!u._isSystem && u.auth_user_id && (
                          <span className="badge" style={{ background: '#EFF6FF', color: '#2563EB', fontSize: 9.5, padding: '1px 6px' }}>🔑 login</span>
                        )}
                      </div>
                    </td>
                    <td>
                      <span className="badge" style={{ background: lvl.bg, color: lvl.color, fontSize: 11 }}>
                        {u.role_label || ro?.label || u.role_id}
                      </span>
                    </td>
                    <td>
                      <span className="badge" style={{ background: lvl.bg, color: lvl.color, fontSize: 11 }}>
                        {ro?.level || '—'}
                      </span>
                    </td>
                    <td className="text-slate-500 text-xs">{u.plants?.name || u.plant_name || <span className="text-slate-300">—</span>}</td>
                    <td className="text-slate-500 text-xs">{u.designation || <span className="text-slate-300">—</span>}</td>
                    <td>
                      <span className="badge" style={{ background: sc.bg, color: sc.color, fontWeight: 700 }}>{sc.label}</span>
                    </td>
                    <td className="text-slate-400 text-xs">{u._isSystem ? <span className="text-slate-300">—</span> : formatDate(u.created_at)}</td>
                    <td>
                      {u._isSystem ? (
                        <span className="text-[11px] text-slate-400 italic">System profile</span>
                      ) : (
                        <div className="flex gap-2">
                          <button onClick={() => openEdit(u)}
                            style={{ padding: '5px 12px', borderRadius: 10, border: '1px solid #E2E8F0', background: '#F8FAFC', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, color: '#475569' }}>
                            Edit
                          </button>
                          <button onClick={() => toggleStatus(u)}
                            style={{ padding: '5px 12px', borderRadius: 10, border: `1px solid ${u.is_active ? '#FECACA' : '#BBF7D0'}`, background: u.is_active ? '#FEF2F2' : '#F0FDF4', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, color: u.is_active ? '#DC2626' : '#16A34A' }}>
                            {u.is_active ? 'Deactivate' : 'Activate'}
                          </button>
                          <button onClick={() => openHistory(u)} title="View change history"
                            style={{ padding: '5px 12px', borderRadius: 10, border: '1px solid #E2E8F0', background: '#fff', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, color: '#64748B', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l4 2"/></svg>
                            History
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Slide panel: Add / Edit user ────────────────────────────────────── */}
      <SlidePanel
        open={showPanel}
        onClose={() => { setShowPanel(false); setSaved(false); setEditingUser(null); }}
        title={editingUser ? 'Edit user' : 'Add user'}
        subtitle="User Management · Admin"
      >
        {/* Name + Mobile */}
        <PanelRow>
          <PanelField label="Full name *">
            <PanelInput value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Ramesh Yadav" />
          </PanelField>
          <PanelField label="Mobile number *">
            <PanelInput type="tel" value={form.mobile} onChange={e => setForm(f => ({ ...f, mobile: e.target.value }))} placeholder="e.g. 9876543210" />
          </PanelField>
        </PanelRow>

        {/* WhatsApp + Email */}
        <PanelRow>
          <PanelField label="WhatsApp (if different)">
            <PanelInput type="tel" value={form.whatsapp} onChange={e => setForm(f => ({ ...f, whatsapp: e.target.value }))} placeholder="Leave blank if same as mobile" />
          </PanelField>
          <PanelField label="Email">
            <PanelInput type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="e.g. ramesh@suntek.in" />
          </PanelField>
        </PanelRow>

        {/* Role + Level preview */}
        <PanelField label="Role *">
          <PanelSelect value={form.role_id} onChange={e => setForm(f => ({ ...f, role_id: e.target.value }))}>
            {ROLE_OPTIONS.map(r => (
              <option key={r.id} value={r.id}>{r.level} · {r.label}</option>
            ))}
          </PanelSelect>
        </PanelField>

        {/* Role description card */}
        {selectedRole && (
          <div style={{ marginBottom: 16, background: (LEVEL_COLOR[selectedRole.level] || {}).bg || '#F8FAFC', border: `1px solid ${(LEVEL_COLOR[selectedRole.level] || {}).color || '#E2E8F0'}30`, borderRadius: 12, padding: '10px 14px' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: (LEVEL_COLOR[selectedRole.level] || {}).color || '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {selectedRole.level} · {selectedRole.label}
            </div>
            <div style={{ fontSize: 11, color: '#64748B', marginTop: 3 }}>
              {getRoleDescription(selectedRole.id)}
            </div>
          </div>
        )}

        {/* Plant + Designation */}
        <PanelRow>
          <PanelField label="Plant / location">
            <PanelSelect value={form.plant} onChange={e => setForm(f => ({ ...f, plant: e.target.value }))}>
              <option value="">— Select plant —</option>
              {plantNames.map(p => <option key={p}>{p}</option>)}
            </PanelSelect>
          </PanelField>
          <PanelField label="Designation / job title">
            <PanelInput value={form.designation} onChange={e => setForm(f => ({ ...f, designation: e.target.value }))} placeholder="e.g. Store In-Charge" />
          </PanelField>
        </PanelRow>

        {/* Preferred language */}
        <PanelField label="Preferred language">
          <PanelSelect value={form.preferred_language} onChange={e => setForm(f => ({ ...f, preferred_language: e.target.value }))}>
            {LANGUAGE_OPTIONS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
          </PanelSelect>
        </PanelField>

        {/* Access note */}
        <PanelField label="Access note (optional)">
          <PanelTextarea value={form.access_note} onChange={e => setForm(f => ({ ...f, access_note: e.target.value }))} placeholder="Any notes about this user's access scope, restrictions, or special permissions…" />
        </PanelField>

        {/* ── Login access ─────────────────────────────────────────────────── */}
        <div style={{ marginBottom: 16, background: '#F8FAFC', borderRadius: 12, border: '1px solid #E2E8F0', padding: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#0F172A' }}>
                Dashboard login {editingUser?.auth_user_id && <span style={{ fontSize: 11, color: '#16A34A', fontWeight: 700 }}>· account exists</span>}
              </div>
              <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 1 }}>
                Give this person a sign-in. They'll log in with the email above and the password you set here.
              </div>
            </div>
            <button
              type="button"
              onClick={() => setForm(f => ({ ...f, login_enabled: !f.login_enabled }))}
              style={{
                width: 44, height: 24, borderRadius: 12,
                background: form.login_enabled ? '#2563EB' : '#CBD5E1',
                border: 'none', cursor: 'pointer', position: 'relative', transition: 'background 0.2s', flexShrink: 0,
              }}
            >
              <div style={{ width: 18, height: 18, borderRadius: '50%', background: '#fff', position: 'absolute', top: 3, transition: 'left 0.2s', left: form.login_enabled ? 22 : 4 }} />
            </button>
          </div>

          {form.login_enabled && (
            <div style={{ marginTop: 12 }}>
              {!form.email.trim() && (
                <div style={{ fontSize: 11, color: '#DC2626', marginBottom: 8 }}>
                  ⚠ Set the <strong>Email</strong> field above — it's the login username.
                </div>
              )}
              <PanelField label={editingUser?.auth_user_id ? 'Set new password (leave blank to keep current)' : 'Password *'}>
                <PanelInput
                  type="password"
                  value={form.password}
                  onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  placeholder={editingUser?.auth_user_id ? 'Leave blank to keep existing password' : 'Min 8 characters — share with the user securely'}
                />
              </PanelField>
              <div style={{ fontSize: 11, color: '#94A3B8' }}>
                The account is activated immediately — the user can sign in right away. You can change email or reset the password here anytime.
              </div>
            </div>
          )}
        </div>

        {/* Active toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, padding: '12px 14px', background: '#F8FAFC', borderRadius: 12, border: '1px solid #E2E8F0' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#0F172A' }}>Account active</div>
            <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 1 }}>Inactive users can't log in</div>
          </div>
          <button
            onClick={() => setForm(f => ({ ...f, is_active: !f.is_active }))}
            style={{
              width: 44, height: 24, borderRadius: 12,
              background: form.is_active ? '#16A34A' : '#CBD5E1',
              border: 'none', cursor: 'pointer', position: 'relative', transition: 'background 0.2s',
            }}
          >
            <div style={{
              width: 18, height: 18, borderRadius: '50%', background: '#fff',
              position: 'absolute', top: 3, transition: 'left 0.2s',
              left: form.is_active ? 22 : 4,
            }} />
          </button>
        </div>

        <PanelDivider />
        <PanelFooter
          saved={saved}
          onCancel={() => { setShowPanel(false); setEditingUser(null); }}
          onSave={handleSave}
          saveLabel={editingUser ? 'Save changes' : 'Add user'}
          successLabel={editingUser ? 'User updated' : 'User added'}
          successSub={editingUser ? 'Changes saved successfully' : 'User account created successfully'}
          disabled={!form.name.trim() || !form.mobile.trim()}
          requiredHint="Fill in name and mobile number to add user"
        />
      </SlidePanel>

      {/* ── History panel: who changed what on this profile ─────────────────── */}
      <SlidePanel
        open={!!historyUser}
        onClose={() => setHistoryUser(null)}
        title="Profile history"
        subtitle={historyUser ? `${historyUser.name} · User Management` : ''}
      >
        {historyLoading ? (
          <div className="text-sm text-slate-400 py-6 text-center">Loading…</div>
        ) : historyEvents.length === 0 ? (
          <div className="text-sm text-slate-400 py-6 text-center">No recorded actions yet for this profile.</div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {historyEvents.map(ev => {
              const cfg = EVENT_CFG[ev.action] || { label: ev.action, bg: '#F1F5F9', color: '#475569' };
              return (
                <div key={ev.id} style={{ border: '1px solid #E2E8F0', borderRadius: 12, padding: '12px 14px' }}>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="badge" style={{ background: cfg.bg, color: cfg.color, fontSize: 10.5, fontWeight: 700 }}>{cfg.label}</span>
                    <span className="text-[11px] text-slate-400">{formatEventTime(ev.created_at)}</span>
                  </div>
                  {ev.details && <div className="text-[13px] text-slate-700 leading-snug">{ev.details}</div>}
                  <div className="text-[11px] text-slate-400 mt-1">
                    by {ev.actor_name || 'Unknown'}{ev.actor_role ? ` · ${ev.actor_role}` : ''}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </SlidePanel>
    </>
  );
}

const EVENT_CFG: Record<string, { label: string; bg: string; color: string }> = {
  created:        { label: 'Created',        bg: '#EFF6FF', color: '#2563EB' },
  self_update:    { label: 'Self update',    bg: '#F5F3FF', color: '#7C3AED' },
  admin_update:   { label: 'Admin update',   bg: '#FFF7ED', color: '#EA580C' },
  password_reset: { label: 'Password reset', bg: '#FEF2F2', color: '#DC2626' },
  login_enabled:  { label: 'Login enabled',  bg: '#F0FDF4', color: '#16A34A' },
  login_disabled: { label: 'Login disabled', bg: '#F1F5F9', color: '#64748B' },
};

function formatEventTime(d: string) {
  return new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function getRoleDescription(roleId: string): string {
  const map: Record<string, string> = {
    admin:               'Full access to all modules, data, and user management',
    unit_head:           'Ops oversight, procurement approvals, maintenance approvals',
    warehouse_manager:   'Dispatch, shipping, inventory out — no financial data',
    store_manager_maint: 'Spare parts store, availability check, handover docs upload',
    labour_manager:      'Labour cost tracking and worker activity log only',
    night_manager:       'GPS check-in form only — no other dashboard access',
    factory_operator:    'Batch entry and OCR upload — data entry only',
    technician_shd:      'Maintenance tickets only — repairs and photo proof upload',
    accountant_delhi:    'Delhi factory financial and operational data — read-only purchase',
    accountant_other:    'All factories except Delhi — read-only purchase data',
  };
  return map[roleId] || 'Custom access';
}
