import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { insertRows, updateRows } from '../../lib/db';
import { createLogin, updateLogin } from '../../lib/adminUsers';
import { useMentionNotifier } from '../../lib/mentions';
import { useBlacklistGuard } from '../../lib/blacklist/guard';
import { useRoleContext } from '../../contexts/RoleContext';
import type { RoleRow } from '../../lib/profiles';
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

type RoleOption = { id: string; label: string; level: string };

// Every dashboard section a role's `allowed_routes` can grant. The union of all
// routes across the seeded roles, with human labels — used by the Role Manager's
// permission checkbox list.
const ALL_DASHBOARD_SECTIONS: { route: string; label: string }[] = [
  { route: '/dashboard',                  label: 'Overview' },
  { route: '/dashboard/batches',          label: 'Batch Sheets' },
  { route: '/dashboard/stock',            label: 'CPM Stock' },
  { route: '/dashboard/night-manager',    label: 'Night Manager Board' },
  { route: '/dashboard/night-entry',      label: 'Night Check-in (entry)' },
  { route: '/dashboard/batch-entry',      label: 'Batch Logger (entry)' },
  { route: '/dashboard/daily-log',        label: 'Daily Unit Log' },
  { route: '/dashboard/warehouse-entry',  label: 'Warehouse Console (entry)' },
  { route: '/dashboard/sales',            label: 'Sales' },
  { route: '/dashboard/customers',        label: 'Customers' },
  { route: '/dashboard/anomalies',        label: 'Anomaly Detection' },
  { route: '/dashboard/anomaly-center',   label: 'Anomaly Operations Center' },
  { route: '/dashboard/cost-intelligence',label: 'Cost & Margin Intelligence' },
  { route: '/dashboard/benchmarking',     label: 'Multi-Plant Benchmarking' },
  { route: '/dashboard/predictive-qc',    label: 'Predictive QC' },
  { route: '/dashboard/working-capital',  label: 'Working Capital & Cash' },
  { route: '/dashboard/oil-ratio',        label: 'Oil Ratio Reference' },
  { route: '/dashboard/audit',            label: 'Audit Trail' },
  { route: '/dashboard/blacklist',        label: 'Blacklist Registry' },
  { route: '/dashboard/purchase/far',     label: 'Fixed Asset Register' },
  { route: '/dashboard/purchase/maint',   label: 'Maintenance' },
  { route: '/dashboard/purchase/activity',label: 'Plant Activity Log' },
  { route: '/dashboard/purchase/storereq',label: 'Store Requisitions' },
  { route: '/dashboard/purchase/purchase',label: 'Purchase Orders' },
  { route: '/dashboard/purchase/marine',  label: 'Marine Insurance' },
  { route: '/dashboard/purchase/labour',  label: 'Labour Costs' },
];

const LEVEL_OPTIONS = ['L1', 'L2', 'L3', 'L4'];

/** Auto-derive a slug id from a role label. */
function slugify(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

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

// ── Component ─────────────────────────────────────────────────────────────────

export function UserManagement() {
  const { t } = useTranslation();
  const toast = useToast();
  const notifyMentions = useMentionNotifier();
  const screenBlacklist = useBlacklistGuard();
  const { activeProfile, roles, rolesStatus, refreshRoles } = useRoleContext();
  const isAdmin = activeProfile.id === 'admin';
  // Role dropdown options sourced from the live role catalog.
  const roleOptions: RoleOption[] = roles.map(r => ({ id: r.id, label: r.label, level: r.level }));
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

  // ── Role Management (admin-only) ──────────────────────────────────────────
  const [showRoleManager, setShowRoleManager] = useState(false);
  const [editingRole, setEditingRole] = useState<RoleRow | null>(null); // null + showRoleForm = creating
  const [showRoleForm, setShowRoleForm] = useState(false);
  const [savingRole, setSavingRole] = useState(false);
  const [deletingRoleId, setDeletingRoleId] = useState<string | null>(null);
  const [roleForm, setRoleForm] = useState<{
    label: string; id: string; level: string; home_route: string;
    standalone_only: boolean; allowed_routes: string[];
  }>({ label: '', id: '', level: 'L1', home_route: '/dashboard', standalone_only: false, allowed_routes: [] });
  // While creating, keep the slug auto-synced to the label until the user edits it.
  const [slugTouched, setSlugTouched] = useState(false);

  function openRoleAdd() {
    setEditingRole(null);
    setSlugTouched(false);
    setRoleForm({ label: '', id: '', level: 'L1', home_route: '/dashboard', standalone_only: false, allowed_routes: [] });
    setShowRoleForm(true);
  }

  function openRoleEdit(r: RoleRow) {
    if (r.is_admin || r.is_system) return; // locked — full access, not editable
    setEditingRole(r);
    setSlugTouched(true);
    setRoleForm({
      label: r.label,
      id: r.id,
      level: r.level,
      home_route: r.home_route || '/dashboard',
      standalone_only: r.standalone_only,
      allowed_routes: r.allowed_routes?.includes('*') ? [] : (r.allowed_routes || []),
    });
    setShowRoleForm(true);
  }

  function toggleRoleRoute(route: string) {
    setRoleForm(f => ({
      ...f,
      allowed_routes: f.allowed_routes.includes(route)
        ? f.allowed_routes.filter(x => x !== route)
        : [...f.allowed_routes, route],
    }));
  }

  async function handleSaveRole() {
    const label = roleForm.label.trim();
    if (!label) { toast.error('Role name is required'); return; }
    const id = editingRole ? editingRole.id : (slugTouched ? slugify(roleForm.id) : slugify(label));
    if (!id) { toast.error('A valid slug id is required'); return; }
    if (savingRole) return;
    setSavingRole(true);
    try {
      if (!editingRole && roles.some(r => r.id === id)) {
        toast.error(`A role with id "${id}" already exists`);
        return;
      }
      const payload = {
        label,
        level: roleForm.level,
        home_route: roleForm.home_route.trim() || '/dashboard',
        allowed_routes: roleForm.allowed_routes,
        standalone_only: roleForm.standalone_only,
      };
      if (editingRole) {
        const { error } = await updateRows('roles', payload).eq('id', editingRole.id);
        if (error) { toast.error(`Save failed: ${error.message}`); return; }
      } else {
        const { error } = await insertRows('roles', {
          id, ...payload, is_admin: false, is_system: false,
          description: null, avatar_from: null, avatar_to: null,
          sort_order: (roles.reduce((m, r) => Math.max(m, r.sort_order ?? 0), 0)) + 1,
        });
        if (error) { toast.error(`Create failed: ${error.message}`); return; }
      }
      await refreshRoles();
      setShowRoleForm(false);
      setEditingRole(null);
      toast.success(editingRole ? 'Role updated' : 'Role created');
    } finally {
      setSavingRole(false);
    }
  }

  async function handleDeleteRole(r: RoleRow) {
    if (r.is_admin || r.is_system) return;
    if (users.some(u => u.role_id === r.id)) {
      toast.error(`Cannot delete "${r.label}" — users are still assigned to it`);
      return;
    }
    if (!window.confirm(`Delete role "${r.label}"? This cannot be undone.`)) return;
    setDeletingRoleId(r.id);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.from('roles') as any).delete().eq('id', r.id);
      if (error) { toast.error(`Delete failed: ${error.message}`); return; }
      await refreshRoles();
      toast.success('Role deleted');
    } finally {
      setDeletingRoleId(null);
    }
  }

  const loadData = useCallback(async () => {
    setLoading(true);
    const [{ data: usersData }, { data: plantsData }] = await Promise.all([
      supabase.from('user_accounts').select('*, plants(name)').order('created_at', { ascending: false }).returns<DisplayUser[]>(),
      supabase.from('plants').select('id, name').returns<{ id: string; name: string }[]>(),
    ]);
    // The user list is purely the DB directory (user_accounts + plants join).
    setUsers(usersData || []);
    if (plantsData?.length) setPlants(plantsData);
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const plantNames = plants.map(p => p.name);
  const total = users.length;
  const activeCount = users.filter(u => u.is_active).length;
  const roleBreakdown = roleOptions.map(r => ({
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
    // A user needs a name and at least one contact identifier (email or phone).
    if (!form.name.trim() || (!form.email.trim() && !form.mobile.trim())) return;

    const existingAuthId = editingUser?.auth_user_id || null;
    // A brand-new login is being provisioned when login is enabled but no auth
    // user is linked yet (new user, or enabling login on an existing directory row).
    const provisioningNewLogin = form.login_enabled && !existingAuthId;
    if (provisioningNewLogin) {
      // Login can be by email OR phone — need at least one so the user can be found.
      if (!form.email.trim() && !form.mobile.trim()) { toast.error(t('userMgmt.errLoginIdentifierRequired')); return; }
      if (form.password.length < 8) { toast.error(t('userMgmt.errPasswordMin')); return; }
    }

    // Provisioning a login hits the admin edge function, which requires a REAL
    // admin session. Guard up-front so we never create a half-user (directory row
    // saved, login failed) when there's no session — e.g. the dev "enter
    // dashboard" bypass or an expired token.
    if (form.login_enabled) {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { toast.error(t('userMgmt.errNoSessionForLogin')); return; }
    }

    const plant = plants.find(p => p.name === form.plant);
    const email = form.email.trim() || null;
    const payload = {
      name: form.name.trim(),
      mobile: form.mobile.trim(),
      email,
      whatsapp: form.whatsapp.trim() || null,
      role_id: form.role_id,
      role_label: roleOptions.find(r => r.id === form.role_id)?.label || form.role_id,
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
      if (error) { toast.error(t('userMgmt.errUpdateFailed', { msg: error.message })); return; }
    } else {
      const { data, error } = await insertRows('user_accounts', payload).select('id').single();
      if (error) {
        const dupMobile = /duplicate|unique/i.test(error.message) && /mobile/i.test(error.message);
        toast.error(dupMobile ? t('userMgmt.errDuplicateMobile') : t('userMgmt.errSaveFailed', { msg: error.message }));
        return;
      }
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
        if (error) { toast.error(t('userMgmt.errLoginUpdateFailed', { msg: error })); return; }
      } else {
        const { error } = await createLogin({
          user_account_id: accountId,
          email: email ?? undefined, // omit → phone-only login (synthetic auth email)
          password: form.password,
          name: form.name.trim(),
          role_id: form.role_id,
          plant_id: plant?.id || null,
        });
        if (error) {
          // Login provisioning failed. If we just inserted a brand-new directory
          // row for this user, roll it back so no half-created (login-disabled)
          // account is left behind — otherwise a retry hits the unique-phone
          // constraint and throws a confusing duplicate error.
          if (!editingUser && accountId) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (supabase.from('user_accounts') as any).delete().eq('id', accountId);
          }
          toast.error(t('userMgmt.errLoginCreateFailed', { msg: error }));
          return;
        }
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
        details: `Created${form.login_enabled ? ' with login' : ' (directory only)'} · role ${roleOptions.find(r => r.id === form.role_id)?.label || form.role_id}`,
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

  const selectedRole = roles.find(r => r.id === form.role_id);

  return (
    <>
      {/* KPI row */}
      <div className="grid grid-cols-12 gap-5 mb-5">
        <div className="col-span-12 lg:col-span-3 card p-5">
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">{t('userMgmt.totalUsers')}</div>
          <div className="text-[28px] font-extrabold mt-1 num">{total}</div>
          <div className="text-[11px] text-slate-500 mt-1">{t('userMgmt.allRolesSub')}</div>
        </div>
        <div className="col-span-12 lg:col-span-3 card p-5">
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">{t('userMgmt.active')}</div>
          <div className="text-[28px] font-extrabold mt-1 num text-green-600">{activeCount}</div>
          <div className="text-[11px] text-slate-400 mt-1">{t('userMgmt.inactiveCount', { count: total - activeCount })}</div>
        </div>
        <div className="col-span-12 lg:col-span-6 card p-5">
          <div className="text-[11px] text-slate-500 uppercase tracking-wider mb-3">{t('userMgmt.byRole')}</div>
          <div className="flex flex-wrap gap-2">
            {roleBreakdown.length === 0 && <div className="text-[11px] text-slate-400">{t('userMgmt.noUsersYet')}</div>}
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
            <div className="text-base font-bold">{t('userMgmt.userAccounts')}</div>
            <div className="text-xs text-slate-500">{t('userMgmt.userAccountsSub')}</div>
          </div>
          <div className="flex gap-2">
            {isAdmin && (
              <button
                className="pill px-4 py-2 font-semibold text-sm"
                style={{ border: '1.5px solid #E2E8F0', background: '#fff', color: '#475569', cursor: 'pointer' }}
                onClick={() => setShowRoleManager(true)}
              >
                ⚙ {t('userMgmt.manageRoles', 'Manage Roles')}
              </button>
            )}
            <button className="btn-accent pill px-4 py-2 font-semibold text-sm" onClick={openAdd}>
              + {t('userMgmt.addUser')}
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-3 mb-4 flex-wrap">
          <input
            type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder={t('userMgmt.searchPlaceholder')}
            style={{ padding: '8px 14px', borderRadius: 12, border: '1.5px solid #E2E8F0', fontSize: 13, outline: 'none', fontFamily: 'inherit', minWidth: 220 }}
          />
          <select value={filterRole} onChange={e => setFilterRole(e.target.value)}
            style={{ padding: '8px 14px', borderRadius: 12, border: '1.5px solid #E2E8F0', fontSize: 13, fontFamily: 'inherit', background: '#fff' }}>
            <option value="all">{t('userMgmt.allRoles')}</option>
            {roleOptions.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
            style={{ padding: '8px 14px', borderRadius: 12, border: '1.5px solid #E2E8F0', fontSize: 13, fontFamily: 'inherit', background: '#fff' }}>
            <option value="all">{t('userMgmt.allStatus')}</option>
            <option value="active">{t('userMgmt.active')}</option>
            <option value="inactive">{t('userMgmt.inactive')}</option>
          </select>
        </div>

        <div className="overflow-x-auto scroll-x">
          <table className="dt">
            <thead>
              <tr>
                <th>{t('userMgmt.colName')}</th>
                <th>{t('userMgmt.colMobile')}</th>
                <th>{t('userMgmt.colWhatsApp')}</th>
                <th>{t('userMgmt.colEmail')}</th>
                <th>{t('userMgmt.colRole')}</th>
                <th>{t('userMgmt.colLevel')}</th>
                <th>{t('userMgmt.colPlant')}</th>
                <th>{t('userMgmt.colDesignation')}</th>
                <th>{t('userMgmt.colStatus')}</th>
                <th>{t('userMgmt.colAdded')}</th>
                <th>{t('userMgmt.colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={11} className="text-center text-slate-400 py-6 text-sm">{t('userMgmt.loading')}</td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={11} className="text-center text-slate-400 py-6 text-sm">
                  {total === 0 ? t('userMgmt.emptyNoUsers') : t('userMgmt.emptyNoMatch')}
                </td></tr>
              )}
              {filtered.map(u => {
                const ro = roleOptions.find(r => r.id === u.role_id);
                const lvl = ro ? LEVEL_COLOR[ro.level] : { bg: '#F1F5F9', color: '#64748B' };
                const sc = u.is_active ? STATUS_CFG.active : STATUS_CFG.inactive;
                return (
                  <tr key={u.id}>
                    <td>
                      <div className="flex items-center gap-2">
                        <div className="font-semibold text-slate-800">{u.name}</div>
                        {u._isSystem && (
                          <span className="badge" style={{ background: '#F1F5F9', color: '#94A3B8', fontSize: 10, padding: '1px 6px' }}>{t('userMgmt.builtIn')}</span>
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
                          <span className="badge" style={{ background: '#EFF6FF', color: '#2563EB', fontSize: 9.5, padding: '1px 6px' }}>🔑 {t('userMgmt.login')}</span>
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
                      <span className="badge" style={{ background: sc.bg, color: sc.color, fontWeight: 700 }}>{u.is_active ? t('userMgmt.active') : t('userMgmt.inactive')}</span>
                    </td>
                    <td className="text-slate-400 text-xs">{u._isSystem ? <span className="text-slate-300">—</span> : formatDate(u.created_at)}</td>
                    <td>
                      {u._isSystem ? (
                        <span className="text-[11px] text-slate-400 italic">{t('userMgmt.systemProfile')}</span>
                      ) : (
                        <div className="flex gap-2">
                          <button onClick={() => openEdit(u)}
                            style={{ padding: '5px 12px', borderRadius: 10, border: '1px solid #E2E8F0', background: '#F8FAFC', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, color: '#475569' }}>
                            {t('userMgmt.edit')}
                          </button>
                          <button onClick={() => toggleStatus(u)}
                            style={{ padding: '5px 12px', borderRadius: 10, border: `1px solid ${u.is_active ? '#FECACA' : '#BBF7D0'}`, background: u.is_active ? '#FEF2F2' : '#F0FDF4', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, color: u.is_active ? '#DC2626' : '#16A34A' }}>
                            {u.is_active ? t('userMgmt.deactivate') : t('userMgmt.activate')}
                          </button>
                          <button onClick={() => openHistory(u)} title={t('userMgmt.viewHistory')}
                            style={{ padding: '5px 12px', borderRadius: 10, border: '1px solid #E2E8F0', background: '#fff', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, color: '#64748B', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l4 2"/></svg>
                            {t('userMgmt.history')}
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
        title={editingUser ? t('userMgmt.editUser') : t('userMgmt.addUser')}
        subtitle={t('userMgmt.panelSubtitle')}
      >
        {/* Name + Mobile */}
        <PanelRow>
          <PanelField label={t('userMgmt.fullName')}>
            <PanelInput value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder={t('userMgmt.fullNamePlaceholder')} />
          </PanelField>
          <PanelField label={t('userMgmt.mobileNumber')}>
            <PanelInput type="tel" value={form.mobile} onChange={e => setForm(f => ({ ...f, mobile: e.target.value }))} placeholder={t('userMgmt.mobilePlaceholder')} />
          </PanelField>
        </PanelRow>

        {/* WhatsApp + Email */}
        <PanelRow>
          <PanelField label={t('userMgmt.whatsappLabel')}>
            <PanelInput type="tel" value={form.whatsapp} onChange={e => setForm(f => ({ ...f, whatsapp: e.target.value }))} placeholder={t('userMgmt.whatsappPlaceholder')} />
          </PanelField>
          <PanelField label={t('userMgmt.emailLabel')}>
            <PanelInput type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder={t('userMgmt.emailPlaceholder')} />
          </PanelField>
        </PanelRow>
        <div style={{ fontSize: 11, color: '#94A3B8', marginTop: -8, marginBottom: 14 }}>
          {t('userMgmt.contactHint')}
        </div>

        {/* Role + Level preview */}
        <PanelField label={t('userMgmt.roleLabel')}>
          <PanelSelect value={form.role_id} onChange={e => setForm(f => ({ ...f, role_id: e.target.value }))}>
            {roleOptions.map(r => (
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
              {selectedRole.description || 'Custom access'}
            </div>
          </div>
        )}

        {/* Plant + Designation */}
        <PanelRow>
          <PanelField label={t('userMgmt.plantLabel')}>
            <PanelSelect value={form.plant} onChange={e => setForm(f => ({ ...f, plant: e.target.value }))}>
              <option value="">{t('userMgmt.selectPlant')}</option>
              {plantNames.map(p => <option key={p}>{p}</option>)}
            </PanelSelect>
          </PanelField>
          <PanelField label={t('userMgmt.designationLabel')}>
            <PanelInput value={form.designation} onChange={e => setForm(f => ({ ...f, designation: e.target.value }))} placeholder={t('userMgmt.designationPlaceholder')} />
          </PanelField>
        </PanelRow>

        {/* Preferred language */}
        <PanelField label={t('userMgmt.preferredLanguage')}>
          <PanelSelect value={form.preferred_language} onChange={e => setForm(f => ({ ...f, preferred_language: e.target.value }))}>
            {LANGUAGE_OPTIONS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
          </PanelSelect>
        </PanelField>

        {/* Access note */}
        <PanelField label={t('userMgmt.accessNoteLabel')}>
          <PanelTextarea value={form.access_note} onChange={e => setForm(f => ({ ...f, access_note: e.target.value }))} placeholder={t('userMgmt.accessNotePlaceholder')} />
        </PanelField>

        {/* ── Login access ─────────────────────────────────────────────────── */}
        <div style={{ marginBottom: 16, background: '#F8FAFC', borderRadius: 12, border: '1px solid #E2E8F0', padding: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#0F172A' }}>
                {t('userMgmt.dashboardLogin')} {editingUser?.auth_user_id && <span style={{ fontSize: 11, color: '#16A34A', fontWeight: 700 }}>{t('userMgmt.accountExists')}</span>}
              </div>
              <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 1 }}>
                {t('userMgmt.loginHelper')}
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
              {!form.email.trim() && !form.mobile.trim() && (
                <div style={{ fontSize: 11, color: '#DC2626', marginBottom: 8 }}>
                  {t('userMgmt.setLoginIdentifierWarn')}
                </div>
              )}
              <PanelField label={editingUser?.auth_user_id ? t('userMgmt.setNewPassword') : t('userMgmt.passwordLabel')}>
                <PanelInput
                  type="password"
                  value={form.password}
                  onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  placeholder={editingUser?.auth_user_id ? t('userMgmt.passwordKeepPlaceholder') : t('userMgmt.passwordNewPlaceholder')}
                />
              </PanelField>
              <div style={{ fontSize: 11, color: '#94A3B8' }}>
                {t('userMgmt.accountActivatedHelper')}
              </div>
            </div>
          )}
        </div>

        {/* Active toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, padding: '12px 14px', background: '#F8FAFC', borderRadius: 12, border: '1px solid #E2E8F0' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#0F172A' }}>{t('userMgmt.accountActive')}</div>
            <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 1 }}>{t('userMgmt.accountActiveHelper')}</div>
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
          saveLabel={editingUser ? t('userMgmt.saveChanges') : t('userMgmt.addUser')}
          successLabel={editingUser ? t('userMgmt.userUpdated') : t('userMgmt.userAdded')}
          successSub={editingUser ? t('userMgmt.userUpdatedSub') : t('userMgmt.userAddedSub')}
          disabled={!form.name.trim() || (!form.email.trim() && !form.mobile.trim())}
          requiredHint={t('userMgmt.requiredHint')}
        />
      </SlidePanel>

      {/* ── History panel: who changed what on this profile ─────────────────── */}
      <SlidePanel
        open={!!historyUser}
        onClose={() => setHistoryUser(null)}
        title={t('userMgmt.profileHistory')}
        subtitle={historyUser ? `${historyUser.name} · ${t('userMgmt.panelSubtitleHistory')}` : ''}
      >
        {historyLoading ? (
          <div className="text-sm text-slate-400 py-6 text-center">{t('userMgmt.loading')}</div>
        ) : historyEvents.length === 0 ? (
          <div className="text-sm text-slate-400 py-6 text-center">{t('userMgmt.noHistory')}</div>
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
                    {t('userMgmt.by')} {ev.actor_name || t('userMgmt.unknown')}{ev.actor_role ? ` · ${ev.actor_role}` : ''}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </SlidePanel>

      {/* ── Role Manager: list roles, create / edit / delete ─────────────────── */}
      <SlidePanel
        open={showRoleManager}
        onClose={() => setShowRoleManager(false)}
        title={t('userMgmt.roleManager', 'Role Management')}
        subtitle={t('userMgmt.roleManagerSub', 'Define roles and what each can access')}
      >
        <div className="flex justify-end mb-3">
          <button className="btn-accent pill px-4 py-2 font-semibold text-sm" onClick={openRoleAdd}>
            + {t('userMgmt.addRole', 'New Role')}
          </button>
        </div>
        <div className="flex flex-col gap-2.5">
          {rolesStatus === 'loading' && roles.length === 0 && (
            <div className="text-sm text-slate-400 py-6 text-center">{t('userMgmt.loading')}</div>
          )}
          {rolesStatus === 'failed' && (
            <div className="text-sm text-rose-500 py-6 text-center">
              {t('userMgmt.rolesLoadFailed', 'Could not load roles. Check the database connection and that the roles table exists.')}
            </div>
          )}
          {rolesStatus === 'ready' && roles.length === 0 && (
            <div className="text-sm text-slate-400 py-6 text-center">
              {t('userMgmt.noRoles', 'No roles yet. Click “New Role” to create one.')}
            </div>
          )}
          {roles.map(r => {
            const locked = r.is_admin || r.is_system;
            const lvl = LEVEL_COLOR[r.level] || { bg: '#F1F5F9', color: '#64748B' };
            const userCount = users.filter(u => u.role_id === r.id).length;
            const access = r.allowed_routes?.includes('*')
              ? 'All sections'
              : `${r.allowed_routes?.length || 0} section${(r.allowed_routes?.length || 0) === 1 ? '' : 's'}`;
            return (
              <div key={r.id} style={{ border: '1px solid #E2E8F0', borderRadius: 12, padding: '12px 14px' }}>
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="badge" style={{ background: lvl.bg, color: lvl.color, fontSize: 11, fontWeight: 700 }}>{r.level}</span>
                      <span className="font-semibold text-slate-800 text-sm">{r.label}</span>
                      {locked && (
                        <span className="badge" style={{ background: '#FFF7ED', color: '#EA580C', fontSize: 9.5, padding: '1px 6px' }}>🔒 {t('userMgmt.locked', 'Locked')}</span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-400 mt-1">
                      {r.id} · {access} · {userCount} user{userCount === 1 ? '' : 's'}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      disabled={locked}
                      onClick={() => openRoleEdit(r)}
                      style={{ padding: '5px 12px', borderRadius: 10, border: '1px solid #E2E8F0', background: locked ? '#F8FAFC' : '#fff', fontSize: 12, cursor: locked ? 'not-allowed' : 'pointer', fontWeight: 600, color: locked ? '#CBD5E1' : '#475569' }}>
                      {t('userMgmt.edit')}
                    </button>
                    <button
                      disabled={locked || deletingRoleId === r.id}
                      onClick={() => handleDeleteRole(r)}
                      style={{ padding: '5px 12px', borderRadius: 10, border: `1px solid ${locked ? '#E2E8F0' : '#FECACA'}`, background: locked ? '#F8FAFC' : '#FEF2F2', fontSize: 12, cursor: locked ? 'not-allowed' : 'pointer', fontWeight: 600, color: locked ? '#CBD5E1' : '#DC2626' }}>
                      {deletingRoleId === r.id ? '…' : t('userMgmt.delete', 'Delete')}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </SlidePanel>

      {/* ── Role form: create / edit a role ──────────────────────────────────── */}
      <SlidePanel
        open={showRoleForm}
        onClose={() => { setShowRoleForm(false); setEditingRole(null); }}
        title={editingRole ? t('userMgmt.editRole', 'Edit Role') : t('userMgmt.addRole', 'New Role')}
        subtitle={t('userMgmt.roleFormSub', 'Name, level and dashboard access')}
      >
        <PanelRow>
          <PanelField label={t('userMgmt.roleNameLabel', 'Role name')}>
            <PanelInput
              value={roleForm.label}
              onChange={e => setRoleForm(f => ({
                ...f,
                label: e.target.value,
                id: editingRole || slugTouched ? f.id : slugify(e.target.value),
              }))}
              placeholder="e.g. Quality Inspector"
            />
          </PanelField>
          <PanelField label={t('userMgmt.roleSlugLabel', 'Slug / id')}>
            <PanelInput
              value={roleForm.id}
              disabled={!!editingRole}
              onChange={e => { setSlugTouched(true); setRoleForm(f => ({ ...f, id: e.target.value })); }}
              placeholder="quality_inspector"
            />
          </PanelField>
        </PanelRow>

        <PanelRow>
          <PanelField label={t('userMgmt.roleLevelLabel', 'Level')}>
            <PanelSelect value={roleForm.level} onChange={e => setRoleForm(f => ({ ...f, level: e.target.value }))}>
              {LEVEL_OPTIONS.map(l => <option key={l} value={l}>{l}</option>)}
            </PanelSelect>
          </PanelField>
          <PanelField label={t('userMgmt.roleHomeRouteLabel', 'Home route')}>
            <PanelInput value={roleForm.home_route} onChange={e => setRoleForm(f => ({ ...f, home_route: e.target.value }))} placeholder="/dashboard" />
          </PanelField>
        </PanelRow>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, padding: '12px 14px', background: '#F8FAFC', borderRadius: 12, border: '1px solid #E2E8F0' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#0F172A' }}>{t('userMgmt.standaloneLabel', 'Standalone only')}</div>
            <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 1 }}>{t('userMgmt.standaloneHelper', 'No dashboard — uses a standalone app')}</div>
          </div>
          <button
            type="button"
            onClick={() => setRoleForm(f => ({ ...f, standalone_only: !f.standalone_only }))}
            style={{ width: 44, height: 24, borderRadius: 12, background: roleForm.standalone_only ? '#2563EB' : '#CBD5E1', border: 'none', cursor: 'pointer', position: 'relative', flexShrink: 0 }}
          >
            <div style={{ width: 18, height: 18, borderRadius: '50%', background: '#fff', position: 'absolute', top: 3, transition: 'left 0.2s', left: roleForm.standalone_only ? 22 : 4 }} />
          </button>
        </div>

        <PanelField label={t('userMgmt.allowedSectionsLabel', 'Dashboard sections this role can access')}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, maxHeight: 320, overflowY: 'auto', padding: 4 }}>
            {ALL_DASHBOARD_SECTIONS.map(s => {
              const on = roleForm.allowed_routes.includes(s.route);
              return (
                <label key={s.route} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: '#334155', cursor: 'pointer', padding: '6px 8px', borderRadius: 8, background: on ? '#EFF6FF' : 'transparent' }}>
                  <input type="checkbox" checked={on} onChange={() => toggleRoleRoute(s.route)} />
                  <span>{s.label}</span>
                </label>
              );
            })}
          </div>
        </PanelField>

        <PanelDivider />
        <PanelFooter
          saved={false}
          onCancel={() => { setShowRoleForm(false); setEditingRole(null); }}
          onSave={handleSaveRole}
          saveLabel={editingRole ? t('userMgmt.saveChanges') : t('userMgmt.addRole', 'Create Role')}
          successLabel=""
          successSub=""
          disabled={!roleForm.label.trim() || savingRole}
          requiredHint={t('userMgmt.requiredHint')}
        />
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

