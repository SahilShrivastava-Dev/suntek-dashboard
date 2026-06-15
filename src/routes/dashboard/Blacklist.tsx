import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { useRoleContext } from '../../contexts/RoleContext';
import { SlidePanel, PanelField, PanelInput, PanelSelect, PanelTextarea, PanelRow, PanelDivider, PanelFooter } from '../../components/SlidePanel';
import type { BlacklistEntry } from '../../contexts/BlacklistContext';

// ── Config ────────────────────────────────────────────────────────────────────

const TYPE_CFG = {
  person:  { label: 'Person',  bg: '#F1F5F9', color: '#475569', icon: '👤' },
  vehicle: { label: 'Vehicle', bg: '#EFF6FF', color: '#2563EB', icon: '🚛' },
  vendor:  { label: 'Vendor',  bg: '#F5F3FF', color: '#7C3AED', icon: '🏢' },
  other:   { label: 'Other',   bg: '#F0FDF4', color: '#16A34A', icon: '⚠' },
};

const SEV_CFG = {
  low:      { label: 'Low',      bg: '#EFF6FF', color: '#2563EB' },
  medium:   { label: 'Medium',   bg: '#FFFBEB', color: '#D97706' },
  high:     { label: 'High',     bg: '#FFF7ED', color: '#EA580C' },
  critical: { label: 'Critical', bg: '#FEF2F2', color: '#DC2626' },
};

const SEV_DESCRIPTIONS: Record<string, string> = {
  low:      'Monitor only — no immediate operational impact',
  medium:   'Caution advised — limited interactions allowed',
  high:     'Block all assignments and access — escalation required',
  critical: 'Immediate halt — notify security and management',
};

const TYPE_LABELS: Record<string, { nameLabel: string; namePlaceholder: string; identifierLabel: string; identifierPlaceholder: string }> = {
  person:  { nameLabel: 'Full name',                     namePlaceholder: 'e.g. Rajesh Kumar',          identifierLabel: 'Employee ID / Aadhaar (last 4)', identifierPlaceholder: 'e.g. EMP-042 or 1234' },
  vehicle: { nameLabel: 'Vehicle registration number',   namePlaceholder: 'e.g. JH01AB1234',             identifierLabel: 'Fleet number / owner name',      identifierPlaceholder: 'e.g. FLEET-07 or driver name' },
  vendor:  { nameLabel: 'Vendor / company name',         namePlaceholder: 'e.g. Shree Chemicals Pvt Ltd', identifierLabel: 'GSTIN / PAN / vendor code',      identifierPlaceholder: 'e.g. 20XXXXX1234Z1' },
  other:   { nameLabel: 'Name / description',            namePlaceholder: 'Enter identifier',             identifierLabel: 'Reference ID',                   identifierPlaceholder: 'Optional reference' },
};

function formatDate(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

const BLANK_FORM = {
  type: 'person' as BlacklistEntry['type'],
  name: '',
  identifier: '',
  reason: '',
  severity: 'high' as BlacklistEntry['severity'],
  notes: '',
  reference_no: '',
};

const BLANK_RESOLVE = { reason: '' };

// ── Page ──────────────────────────────────────────────────────────────────────

export function Blacklist() {
  const { activeProfile } = useRoleContext();

  const [entries, setEntries] = useState<BlacklistEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const [showPanel, setShowPanel] = useState(false);
  const [form, setForm] = useState({ ...BLANK_FORM });
  const [saved, setSaved] = useState(false);

  const [showResolvePanel, setShowResolvePanel] = useState(false);
  const [resolvingEntry, setResolvingEntry] = useState<BlacklistEntry | null>(null);
  const [resolveForm, setResolveForm] = useState({ ...BLANK_RESOLVE });
  const [resolveSaved, setResolveSaved] = useState(false);

  const [showDetailPanel, setShowDetailPanel] = useState(false);
  const [detailEntry, setDetailEntry] = useState<BlacklistEntry | null>(null);

  const [filterType, setFilterType] = useState('all');
  const [filterSev, setFilterSev] = useState('all');
  const [filterStatus, setFilterStatus] = useState('active');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await (supabase.from('blacklist').select('*').order('created_at', { ascending: false }) as any);
    setEntries(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Computed ────────────────────────────────────────────────────────────────
  const active = entries.filter(e => e.is_active);
  const persons  = active.filter(e => e.type === 'person').length;
  const vehicles = active.filter(e => e.type === 'vehicle').length;
  const others   = active.filter(e => e.type === 'vendor' || e.type === 'other').length;

  const filtered = entries.filter(e => {
    if (filterType !== 'all' && e.type !== filterType) return false;
    if (filterSev  !== 'all' && e.severity !== filterSev) return false;
    if (filterStatus === 'active'   && !e.is_active) return false;
    if (filterStatus === 'resolved' && e.is_active)  return false;
    if (search) {
      const q = search.toLowerCase();
      return e.name.toLowerCase().includes(q) ||
             (e.identifier || '').toLowerCase().includes(q) ||
             e.reason.toLowerCase().includes(q) ||
             (e.added_by || '').toLowerCase().includes(q);
    }
    return true;
  });

  // ── Save new entry ──────────────────────────────────────────────────────────
  async function handleSave() {
    if (!form.name.trim() || !form.reason.trim()) return;
    const payload = {
      type: form.type,
      name: form.name.trim(),
      identifier: form.identifier.trim() || null,
      reason: form.reason.trim(),
      severity: form.severity,
      notes: form.notes.trim() || null,
      reference_no: form.reference_no.trim() || null,
      added_by: activeProfile.name,
      added_by_role: activeProfile.roleLabel,
      is_active: true,
    };
    const { error } = await (supabase.from('blacklist') as any).insert(payload);
    if (error) { alert(`Failed: ${error.message}`); return; }

    // Notify admin + unit_head
    (supabase.from('notifications') as any).insert({
      target_roles: ['admin', 'unit_head'],
      title: `New blacklist entry added`,
      body: `${TYPE_CFG[form.type].label} "${form.name.trim()}" blacklisted (${form.severity}) by ${activeProfile.name}`,
      type: 'urgent',
      route: '/dashboard/blacklist',
      actor_name: activeProfile.name,
      actor_role: activeProfile.roleLabel,
      read_by: [],
    }).then(() => {}).catch(() => {});

    setSaved(true);
    await load();
    setTimeout(() => {
      setShowPanel(false);
      setSaved(false);
      setForm({ ...BLANK_FORM });
    }, 1400);
  }

  // ── Resolve (remove from blacklist) ────────────────────────────────────────
  async function handleResolve() {
    if (!resolvingEntry || !resolveForm.reason.trim()) return;
    const { error } = await (supabase.from('blacklist') as any)
      .update({
        is_active: false,
        resolved_at: new Date().toISOString(),
        resolved_by: activeProfile.name,
        resolved_reason: resolveForm.reason.trim(),
      })
      .eq('id', resolvingEntry.id);
    if (error) { alert(`Failed: ${error.message}`); return; }

    (supabase.from('notifications') as any).insert({
      target_roles: ['admin', 'unit_head'],
      title: `Blacklist entry resolved`,
      body: `"${resolvingEntry.name}" removed from blacklist by ${activeProfile.name}`,
      type: 'info',
      route: '/dashboard/blacklist',
      actor_name: activeProfile.name,
      actor_role: activeProfile.roleLabel,
      read_by: [],
    }).then(() => {}).catch(() => {});

    setResolveSaved(true);
    await load();
    setTimeout(() => {
      setShowResolvePanel(false);
      setResolveSaved(false);
      setResolvingEntry(null);
      setResolveForm({ ...BLANK_RESOLVE });
    }, 1400);
  }

  // ── Re-blacklist ────────────────────────────────────────────────────────────
  async function reBlacklist(entry: BlacklistEntry) {
    await (supabase.from('blacklist') as any)
      .update({ is_active: true, resolved_at: null, resolved_by: null, resolved_reason: null })
      .eq('id', entry.id);
    await load();
  }

  const typeLabels = TYPE_LABELS[form.type];

  return (
    <>
      {/* ── KPI row ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-12 gap-5 mb-5">
        <div className="col-span-12 lg:col-span-3 card p-5">
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">Active blacklist</div>
          <div className="text-[28px] font-extrabold mt-1 num text-red-600">{active.length}</div>
          <div className="text-[11px] text-slate-400 mt-1">{entries.filter(e => !e.is_active).length} resolved</div>
        </div>
        <div className="col-span-12 lg:col-span-3 card p-5">
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">Persons</div>
          <div className="text-[28px] font-extrabold mt-1 num">{persons}</div>
          <div className="text-[11px] text-slate-400 mt-1">individuals</div>
        </div>
        <div className="col-span-12 lg:col-span-3 card p-5">
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">Vehicles</div>
          <div className="text-[28px] font-extrabold mt-1 num">{vehicles}</div>
          <div className="text-[11px] text-slate-400 mt-1">registrations</div>
        </div>
        <div className="col-span-12 lg:col-span-3 card p-5">
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">Vendors &amp; Other</div>
          <div className="text-[28px] font-extrabold mt-1 num">{others}</div>
          <div className="text-[11px] text-slate-400 mt-1">entities</div>
        </div>
      </div>

      {/* ── Table card ───────────────────────────────────────────────────── */}
      <div className="card p-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div>
            <div className="text-base font-bold">Blacklist registry</div>
            <div className="text-xs text-slate-500">Track restricted persons, vehicles, and vendors · admin + unit head only</div>
          </div>
          <button
            className="btn-accent pill px-4 py-2 font-semibold text-sm"
            style={{ background: '#DC2626' }}
            onClick={() => { setForm({ ...BLANK_FORM }); setSaved(false); setShowPanel(true); }}
          >
            + Add to blacklist
          </button>
        </div>

        {/* Filters */}
        <div className="flex gap-3 mb-4 flex-wrap">
          <input
            type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search name, reason, added by…"
            style={{ padding: '8px 14px', borderRadius: 12, border: '1.5px solid #E2E8F0', fontSize: 13, outline: 'none', fontFamily: 'inherit', minWidth: 220 }}
          />
          <select value={filterType} onChange={e => setFilterType(e.target.value)}
            style={{ padding: '8px 14px', borderRadius: 12, border: '1.5px solid #E2E8F0', fontSize: 13, fontFamily: 'inherit', background: '#fff' }}>
            <option value="all">All types</option>
            <option value="person">Person</option>
            <option value="vehicle">Vehicle</option>
            <option value="vendor">Vendor</option>
            <option value="other">Other</option>
          </select>
          <select value={filterSev} onChange={e => setFilterSev(e.target.value)}
            style={{ padding: '8px 14px', borderRadius: 12, border: '1.5px solid #E2E8F0', fontSize: 13, fontFamily: 'inherit', background: '#fff' }}>
            <option value="all">All severity</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
            style={{ padding: '8px 14px', borderRadius: 12, border: '1.5px solid #E2E8F0', fontSize: 13, fontFamily: 'inherit', background: '#fff' }}>
            <option value="active">Active</option>
            <option value="resolved">Resolved</option>
            <option value="all">All</option>
          </select>
        </div>

        <div className="overflow-x-auto scroll-x">
          <table className="dt">
            <thead>
              <tr>
                <th>Type</th>
                <th>Name / Identifier</th>
                <th>Reason</th>
                <th>Severity</th>
                <th>Added by</th>
                <th>Date</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={8} className="text-center text-slate-400 py-6 text-sm">Loading…</td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={8} className="text-center text-slate-400 py-6 text-sm">
                  {filterStatus === 'active' && active.length === 0
                    ? 'No active blacklist entries — all clear'
                    : 'No entries match current filters'}
                </td></tr>
              )}
              {filtered.map(e => {
                const tc = TYPE_CFG[e.type] || TYPE_CFG.other;
                const sc = SEV_CFG[e.severity] || SEV_CFG.high;
                return (
                  <tr key={e.id} style={{ opacity: e.is_active ? 1 : 0.55 }}>
                    <td>
                      <span className="badge" style={{ background: tc.bg, color: tc.color, fontSize: 11 }}>
                        {tc.icon} {tc.label}
                      </span>
                    </td>
                    <td>
                      <div className="font-semibold text-slate-800">{e.name}</div>
                      {e.identifier && <div className="text-[11px] text-slate-400">{e.identifier}</div>}
                    </td>
                    <td>
                      <div className="text-sm text-slate-700 max-w-[220px] truncate" title={e.reason}>{e.reason}</div>
                      {e.reference_no && <div className="text-[11px] text-slate-400">Ref: {e.reference_no}</div>}
                    </td>
                    <td>
                      <span className="badge" style={{ background: sc.bg, color: sc.color, fontWeight: 700, fontSize: 11 }}>
                        {sc.label}
                      </span>
                    </td>
                    <td>
                      <div className="text-sm text-slate-700">{e.added_by}</div>
                      {e.added_by_role && <div className="text-[11px] text-slate-400">{e.added_by_role}</div>}
                    </td>
                    <td className="text-slate-500 text-xs">{formatDate(e.created_at)}</td>
                    <td>
                      {e.is_active ? (
                        <span className="badge" style={{ background: '#FEF2F2', color: '#DC2626', fontWeight: 700 }}>Active</span>
                      ) : (
                        <div>
                          <span className="badge" style={{ background: '#F0FDF4', color: '#16A34A', fontWeight: 700 }}>Resolved</span>
                          <div className="text-[10px] text-slate-400 mt-0.5">{formatDate(e.resolved_at)}</div>
                        </div>
                      )}
                    </td>
                    <td>
                      <div className="flex gap-2">
                        <button
                          onClick={() => { setDetailEntry(e); setShowDetailPanel(true); }}
                          style={{ padding: '5px 10px', borderRadius: 8, border: '1px solid #E2E8F0', background: '#F8FAFC', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, color: '#475569' }}
                        >View</button>
                        {e.is_active ? (
                          <button
                            onClick={() => { setResolvingEntry(e); setResolveForm({ ...BLANK_RESOLVE }); setResolveSaved(false); setShowResolvePanel(true); }}
                            style={{ padding: '5px 10px', borderRadius: 8, border: '1px solid #BBF7D0', background: '#F0FDF4', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, color: '#16A34A' }}
                          >Resolve</button>
                        ) : (
                          <button
                            onClick={() => reBlacklist(e)}
                            style={{ padding: '5px 10px', borderRadius: 8, border: '1px solid #FECACA', background: '#FEF2F2', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, color: '#DC2626' }}
                          >Re-add</button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Add panel ────────────────────────────────────────────────────── */}
      <SlidePanel
        open={showPanel}
        onClose={() => { setShowPanel(false); setSaved(false); }}
        title="Add to blacklist"
        subtitle="Blacklist Registry · Admin"
      >
        <PanelField label="Type *">
          <PanelSelect value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value as BlacklistEntry['type'] }))}>
            <option value="person">👤 Person (individual)</option>
            <option value="vehicle">🚛 Vehicle (registration)</option>
            <option value="vendor">🏢 Vendor / supplier</option>
            <option value="other">⚠ Other</option>
          </PanelSelect>
        </PanelField>

        <div style={{ marginBottom: 16, background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 12, padding: '10px 14px', fontSize: 11, color: '#DC2626' }}>
          <strong>Note:</strong> Blacklisted persons will have their dashboard access restricted and all activity will alert admin.
        </div>

        <PanelRow>
          <PanelField label={`${typeLabels.nameLabel} *`}>
            <PanelInput value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder={typeLabels.namePlaceholder} />
          </PanelField>
          <PanelField label={typeLabels.identifierLabel}>
            <PanelInput value={form.identifier} onChange={e => setForm(f => ({ ...f, identifier: e.target.value }))} placeholder={typeLabels.identifierPlaceholder} />
          </PanelField>
        </PanelRow>

        <PanelField label="Reason for blacklisting *">
          <PanelTextarea
            value={form.reason}
            onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
            placeholder="Describe the incident, fraud, breach, or safety concern that led to this blacklisting…"
          />
        </PanelField>

        <PanelField label="Severity *">
          <PanelSelect value={form.severity} onChange={e => setForm(f => ({ ...f, severity: e.target.value as BlacklistEntry['severity'] }))}>
            <option value="critical">Critical — immediate halt</option>
            <option value="high">High — block all access</option>
            <option value="medium">Medium — caution, limited access</option>
            <option value="low">Low — monitor only</option>
          </PanelSelect>
        </PanelField>

        {/* Severity description card */}
        <div style={{ marginBottom: 16, background: SEV_CFG[form.severity].bg, border: `1px solid ${SEV_CFG[form.severity].color}30`, borderRadius: 12, padding: '8px 14px', fontSize: 11, color: SEV_CFG[form.severity].color, fontWeight: 600 }}>
          {SEV_DESCRIPTIONS[form.severity]}
        </div>

        <PanelRow>
          <PanelField label="Reference number">
            <PanelInput value={form.reference_no} onChange={e => setForm(f => ({ ...f, reference_no: e.target.value }))} placeholder="Incident report #, contract #…" />
          </PanelField>
        </PanelRow>

        <PanelField label="Internal notes">
          <PanelTextarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Any additional context, investigation details, or follow-up actions…" />
        </PanelField>

        <PanelDivider />
        <PanelFooter
          saved={saved}
          onCancel={() => { setShowPanel(false); }}
          onSave={handleSave}
          saveLabel="Add to blacklist"
          successLabel="Entry added"
          successSub="Blacklist updated and admin notified"
          disabled={!form.name.trim() || !form.reason.trim()}
          requiredHint="Name and reason are required"
        />
      </SlidePanel>

      {/* ── Resolve panel ────────────────────────────────────────────────── */}
      <SlidePanel
        open={showResolvePanel}
        onClose={() => { setShowResolvePanel(false); setResolveSaved(false); setResolvingEntry(null); }}
        title="Resolve blacklist entry"
        subtitle="Remove restriction · Blacklist Registry"
      >
        {resolvingEntry && (
          <>
            <div style={{ marginBottom: 16, padding: '14px 16px', background: '#FEF2F2', borderRadius: 12, border: '1px solid #FECACA' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#DC2626' }}>
                {TYPE_CFG[resolvingEntry.type].icon} {resolvingEntry.name}
              </div>
              <div style={{ fontSize: 11, color: '#475569', marginTop: 4 }}>{resolvingEntry.reason}</div>
              <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 4 }}>
                Added by {resolvingEntry.added_by} · {formatDate(resolvingEntry.created_at)}
              </div>
            </div>

            <PanelField label="Reason for resolving *">
              <PanelTextarea
                value={resolveForm.reason}
                onChange={e => setResolveForm(f => ({ ...f, reason: e.target.value }))}
                placeholder="Describe why this restriction is being lifted — investigation concluded, issue resolved, misidentification, etc."
              />
            </PanelField>

            <div style={{ marginBottom: 16, padding: '10px 14px', background: '#FFFBEB', borderRadius: 12, border: '1px solid #FDE68A', fontSize: 11, color: '#92400E' }}>
              <strong>This will lift all restrictions</strong> on this entity. If they are a person, their dashboard access will be restored immediately.
            </div>

            <PanelDivider />
            <PanelFooter
              saved={resolveSaved}
              onCancel={() => { setShowResolvePanel(false); setResolvingEntry(null); }}
              onSave={handleResolve}
              saveLabel="Confirm resolve"
              successLabel="Entry resolved"
              successSub="Restrictions lifted and admin notified"
              disabled={!resolveForm.reason.trim()}
              requiredHint="Reason for resolving is required"
            />
          </>
        )}
      </SlidePanel>

      {/* ── Detail panel ─────────────────────────────────────────────────── */}
      <SlidePanel
        open={showDetailPanel}
        onClose={() => { setShowDetailPanel(false); setDetailEntry(null); }}
        title="Blacklist details"
        subtitle="Entry information"
      >
        {detailEntry && (
          <>
            <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
              <span className="badge" style={{ background: TYPE_CFG[detailEntry.type].bg, color: TYPE_CFG[detailEntry.type].color }}>
                {TYPE_CFG[detailEntry.type].icon} {TYPE_CFG[detailEntry.type].label}
              </span>
              <span className="badge" style={{ background: SEV_CFG[detailEntry.severity].bg, color: SEV_CFG[detailEntry.severity].color, fontWeight: 700 }}>
                {SEV_CFG[detailEntry.severity].label}
              </span>
              {detailEntry.is_active
                ? <span className="badge" style={{ background: '#FEF2F2', color: '#DC2626', fontWeight: 700 }}>Active</span>
                : <span className="badge" style={{ background: '#F0FDF4', color: '#16A34A', fontWeight: 700 }}>Resolved</span>}
            </div>

            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Name</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#0F172A' }}>{detailEntry.name}</div>
              {detailEntry.identifier && <div style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>{detailEntry.identifier}</div>}
            </div>

            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Reason</div>
              <div style={{ fontSize: 13, color: '#334155', lineHeight: '1.6' }}>{detailEntry.reason}</div>
            </div>

            {detailEntry.notes && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Notes</div>
                <div style={{ fontSize: 13, color: '#334155', lineHeight: '1.6' }}>{detailEntry.notes}</div>
              </div>
            )}

            {detailEntry.reference_no && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Reference</div>
                <div style={{ fontSize: 13, color: '#334155' }}>{detailEntry.reference_no}</div>
              </div>
            )}

            <div style={{ padding: '12px 14px', background: '#F8FAFC', borderRadius: 12, marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: '#64748B' }}>
                Added by <strong>{detailEntry.added_by}</strong>{detailEntry.added_by_role ? ` · ${detailEntry.added_by_role}` : ''}
              </div>
              <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 2 }}>on {formatDate(detailEntry.created_at)}</div>
            </div>

            {!detailEntry.is_active && (
              <div style={{ padding: '12px 14px', background: '#F0FDF4', borderRadius: 12, border: '1px solid #BBF7D0' }}>
                <div style={{ fontSize: 12, color: '#16A34A', fontWeight: 600 }}>Resolved by {detailEntry.resolved_by} on {formatDate(detailEntry.resolved_at)}</div>
                {detailEntry.resolved_reason && <div style={{ fontSize: 12, color: '#64748B', marginTop: 4 }}>{detailEntry.resolved_reason}</div>}
              </div>
            )}
          </>
        )}
      </SlidePanel>
    </>
  );
}
