import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { insertRows } from '../../../lib/db';
import { uploadWorkflowFile } from '../../../lib/cloudinary';
import { usePlantScope } from '../../../contexts/PlantScopeContext';
import { useRoleContext } from '../../../contexts/RoleContext';
import { useNotifications } from '../../../contexts/NotificationsContext';
import { parseMaintenanceFile, type PMTemplate } from '../../../lib/pm/parseMaintenanceFile';
import { matchAsset, type AssetLite } from '../../../lib/far/assets';
import { FREQ_LABEL, calculateNextDue } from './maintenance/shared';

type Plant = { id: string; name: string };

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  const o = e as { message?: string; details?: string };
  return o?.message || o?.details || JSON.stringify(e);
}

const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 };
const modal: React.CSSProperties = { background: '#fff', borderRadius: 16, padding: 22, width: 'min(720px, 100%)', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' };
const label: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', marginBottom: 4 };
const input: React.CSSProperties = { boxSizing: 'border-box', border: '1px solid #E2E8F0', borderRadius: 8, padding: '8px 10px', fontSize: 13, fontFamily: 'inherit', outline: 'none' };
const btnPrimary: React.CSSProperties = { padding: '10px 16px', borderRadius: 10, border: 'none', background: '#F47651', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' };
const btnGhost: React.CSSProperties = { padding: '10px 16px', borderRadius: 10, border: '1px solid #E2E8F0', background: '#fff', color: '#475569', fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' };

/** Upload a Preventive Maintenance workbook → parse → validate each equipment against
 *  the FAR → create recurring schedules. Soft validation: unmatched equipment is
 *  allowed with a justification and an admin notification (never blocked). */
export function PMScheduleImport({ open, onClose, onImported }: { open: boolean; onClose: () => void; onImported: () => void }) {
  const { activeProfile } = useRoleContext();
  const { allowedPlants } = usePlantScope();
  const { addNotification } = useNotifications();

  const [plants, setPlants] = useState<Plant[]>([]);
  const [technicians, setTechnicians] = useState<{ name: string; plant_id: string | null }[]>([]);
  const [assigneeTech, setAssigneeTech] = useState('');
  const [assets, setAssets] = useState<(AssetLite & { plant_id: string | null })[]>([]);
  const [existing, setExisting] = useState<Set<string>>(new Set());  // `${mark}|${freq}` already scheduled
  const [stage, setStage] = useState<'form' | 'parsing' | 'review' | 'saving' | 'done' | 'error'>('form');
  const [err, setErr] = useState<string | null>(null);
  const [plantIds, setPlantIds] = useState<string[]>([]);   // factories this workbook applies to
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [untilDate, setUntilDate] = useState('');
  const [templates, setTemplates] = useState<PMTemplate[]>([]);
  const [justification, setJustification] = useState('');
  const [fileName, setFileName] = useState('');
  const [cloudUrl, setCloudUrl] = useState<string | null>(null);
  const [createdCount, setCreatedCount] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    (async () => {
      const { data: pl } = await supabase.from('plants').select('id, name').returns<Plant[]>();
      const base = allowedPlants.length ? (allowedPlants as Plant[]) : (pl || []);
      const { data: fa } = await supabase.from('fixed_assets').select('id, name, identification_mark, plant_id').returns<(AssetLite & { plant_id: string | null })[]>();
      const { data: sc } = await supabase.from('maintenance_schedules').select('equipment_mark, frequency, plant_id').returns<{ equipment_mark: string | null; frequency: string; plant_id: string | null }[]>();
      // Technicians (for the default assignee) with their plant.
      const { data: tech } = await supabase.from('user_accounts')
        .select('name, role_id, plant_id').eq('is_active', true)
        .returns<{ name: string; role_id: string | null; plant_id: string | null }[]>();
      if (!alive) return;
      setPlants(base);
      setPlantIds(prev => prev.length ? prev : (base.length === 1 ? [base[0].id] : []));
      setAssets(fa || []);
      setExisting(new Set((sc || []).filter(s => s.equipment_mark).map(s => `${(s.equipment_mark || '').toLowerCase()}|${s.frequency}|${s.plant_id || ''}`)));
      setTechnicians((tech || [])
        .filter(u => (u.role_id || '').toLowerCase().includes('technician'))
        .map(u => ({ name: u.name, plant_id: u.plant_id })));
    })();
    return () => { alive = false; };
  }, [open]); // eslint-disable-line

  // Match each template to a FAR asset (per-plant duplicate-skip happens at save).
  const rows = useMemo(() => templates
    .map(t => ({ t, match: matchAsset(t.equipmentLabel, assets) })), [templates, assets]);
  const matched = rows.filter(r => r.match);
  const unmatched = rows.filter(r => !r.match);
  const byFreq = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.t.frequency, (m.get(r.t.frequency) || 0) + 1);
    return [...m.entries()];
  }, [rows]);

  function reset() { setStage('form'); setTemplates([]); setErr(null); setCloudUrl(null); setJustification(''); setCreatedCount(0); }
  const totalToCreate = rows.length * Math.max(1, plantIds.length);
  function close() { reset(); onClose(); }
  if (!open) return null;

  async function handleFile(file: File) {
    setFileName(file.name); setErr(null); setStage('parsing');
    try {
      try { const up = await uploadWorkflowFile(file, { workflow: 'maintenance', subfolder: 'pm-schedules', kind: 'pm', creator: activeProfile.name }); setCloudUrl(up.secure_url); } catch { /* archive best-effort */ }
      if (!/\.(xlsx|xls)$/i.test(file.name)) throw new Error('Please upload the Preventive Maintenance .xlsx workbook.');
      const res = await parseMaintenanceFile(file);
      if (!res.templates.length) throw new Error('No maintenance schedules found in this workbook.');
      setTemplates(res.templates);
      setStage('review');
    } catch (e) { setErr(errMsg(e)); setStage('error'); }
  }

  async function confirm() {
    if (!plantIds.length) { setErr('Select at least one factory this workbook belongs to.'); return; }
    if (unmatched.length && !justification.trim()) { setErr('Some equipment is not in the FAR — add a justification to proceed.'); return; }
    setStage('saving');
    try {
      const nowStart = new Date(startDate).toISOString();
      const singlePlant = plantIds.length === 1;
      const payload: Record<string, unknown>[] = [];
      // Create the schedule set for EACH selected factory (each has its own FAR copy).
      for (const pid of plantIds) {
        const plantAssets = assets.filter(a => a.plant_id === pid);
        for (const { t } of rows) {
          if (existing.has(`${(t.mark || '').toLowerCase()}|${t.frequency}|${pid}`)) continue; // skip duplicate
          const match = matchAsset(t.equipmentLabel, plantAssets);
          payload.push({
            title: `${t.equipmentType}${t.mark ? ` (${t.mark})` : ''} — ${FREQ_LABEL[t.frequency] || t.frequency}`,
            equipment: t.equipmentLabel, plant_id: pid, frequency: t.frequency,
            description: null,
            // Only the unit head's own (single) plant gets a default technician; the
            // unit head can reassign later. Multi-plant admin import stays unassigned.
            assigned_to: (singlePlant && assigneeTech) ? assigneeTech : null,
            is_active: true, next_due_at: nowStart,
            far_asset_id: match?.asset.id ?? null, equipment_mark: t.mark,
            start_date: startDate, until_date: untilDate || null,
            checklist: t.checklist, requires_approval: t.frequency !== 'daily',
            unmatched_justification: match ? null : justification.trim(), source: 'pm_import',
          });
        }
      }
      for (let i = 0; i < payload.length; i += 200) {
        const { error } = await insertRows('maintenance_schedules', payload.slice(i, i + 200) as never);
        if (error) throw error;
      }
      for (const pid of plantIds) {
        await insertRows('pm_schedule_uploads', { plant_id: pid, file_name: fileName, file_url: cloudUrl, uploaded_by_name: activeProfile.name, sheet_count: 0, schedule_count: payload.filter(p => p.plant_id === pid).length });
        // Notify that plant's unit head so they can assign/verify technicians.
        addNotification({
          target_roles: ['unit_head', 'admin'],
          title: `PM schedules imported for ${plants.find(p => p.id === pid)?.name || 'plant'}`,
          body: `${activeProfile.name} imported ${payload.filter(p => p.plant_id === pid).length} recurring schedules${unmatched.length ? ` · ${unmatched.length} not in FAR (${justification.trim()})` : ''}. Assign technicians as needed.`,
          type: unmatched.length ? 'warning' : 'info', route: '/dashboard/purchase/maint',
          actor_name: activeProfile.name, actor_role: activeProfile.role, plant_id: pid,
        });
      }
      setCreatedCount(payload.length);
      setStage('done');
      onImported();
    } catch (e) { setErr(errMsg(e)); setStage('error'); }
  }

  return (
    <div style={overlay} onClick={() => { if (stage !== 'parsing' && stage !== 'saving') close(); }}>
      <div style={modal} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>Import Preventive Maintenance workbook</div>
          <button onClick={close} style={{ border: 'none', background: 'none', fontSize: 18, cursor: 'pointer', color: '#94A3B8' }}>×</button>
        </div>
        <div style={{ fontSize: 12, color: '#94A3B8', marginBottom: 14 }}>Every schedule is validated against the FAR. Recurring tickets generate automatically until the end date.</div>

        {stage === 'form' && (
          <div>
            {/* Factory selection — multi-select for an admin; auto-scoped (hidden) for a single-plant unit head. */}
            {plants.length > 1 && (
              <div style={{ marginBottom: 12 }}>
                <div style={label}>Factory / factories this workbook applies to *</div>
                <div className="flex gap-2 flex-wrap" style={{ marginTop: 2 }}>
                  {plants.map(p => {
                    const on = plantIds.includes(p.id);
                    return <button key={p.id} onClick={() => setPlantIds(ids => on ? ids.filter(x => x !== p.id) : [...ids, p.id])} className={`chip${on ? ' active' : ''}`}>{on ? '✓ ' : ''}{p.name}</button>;
                  })}
                </div>
                <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 5 }}>{plantIds.length > 1 ? `These schedules will be created for each of the ${plantIds.length} factories; each unit head is notified.` : 'Pick one, or multiple if this workbook is shared across factories.'}</div>
              </div>
            )}
            {/* Default technician — only for a single factory (the unit head can reassign later). */}
            {plantIds.length === 1 && technicians.some(t => t.plant_id === plantIds[0] || t.plant_id === null) && (
              <div style={{ marginBottom: 12 }}>
                <div style={label}>Assign to technician (optional — unit head can change later)</div>
                <select value={assigneeTech} onChange={e => setAssigneeTech(e.target.value)} style={{ ...input, width: '100%' }}>
                  <option value="">— Leave for unit head to assign —</option>
                  {[...new Set(technicians.filter(t => t.plant_id === plantIds[0] || t.plant_id === null).map(t => t.name))].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
              <div style={{ flex: 1, minWidth: 130 }}><div style={label}>Start date</div><input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={{ ...input, width: '100%' }} /></div>
              <div style={{ flex: 1, minWidth: 130 }}><div style={label}>Continue until (optional)</div><input type="date" value={untilDate} onChange={e => setUntilDate(e.target.value)} style={{ ...input, width: '100%' }} /></div>
            </div>
            <button onClick={() => fileRef.current?.click()} style={{ ...btnGhost, width: '100%', padding: '20px', borderStyle: 'dashed' }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#334155' }}>⬆ Upload PM workbook (.xlsx)</div>
              <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 3 }}>Daily · 7/15 Days · 1/2/3/6 Months · Yearly sheets</div>
            </button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }} />
          </div>
        )}

        {stage === 'parsing' && <div style={{ fontSize: 13, color: '#475569', padding: '20px 0' }}>Reading the workbook & matching against the FAR…</div>}

        {stage === 'review' && (
          <div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
              <div style={{ flex: 1, minWidth: 90, background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 10, padding: '8px 12px' }}><div style={{ fontSize: 10.5, color: '#16A34A', fontWeight: 700 }}>IN FAR</div><div style={{ fontSize: 18, fontWeight: 800, color: '#16A34A' }}>{matched.length}</div></div>
              <div style={{ flex: 1, minWidth: 90, background: '#FFFBEB', border: '1px solid #FED7AA', borderRadius: 10, padding: '8px 12px' }}><div style={{ fontSize: 10.5, color: '#B45309', fontWeight: 700 }}>NOT IN FAR</div><div style={{ fontSize: 18, fontWeight: 800, color: '#B45309' }}>{unmatched.length}</div></div>
              <div style={{ flex: 1, minWidth: 90, background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 10, padding: '8px 12px' }}><div style={{ fontSize: 10.5, color: '#64748B', fontWeight: 700 }}>SCHEDULES</div><div style={{ fontSize: 18, fontWeight: 800, color: '#334155' }}>{totalToCreate}</div>{plantIds.length > 1 && <div style={{ fontSize: 10, color: '#94A3B8' }}>{rows.length} × {plantIds.length} plants</div>}</div>
            </div>
            <div style={{ fontSize: 12, color: '#475569', marginBottom: 10 }}>{byFreq.map(([f, n]) => `${FREQ_LABEL[f] || f}: ${n}`).join(' · ')}{templates.length !== rows.length ? ` · ${templates.length - rows.length} already scheduled (skipped)` : ''}</div>

            <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid #E2E8F0', borderRadius: 10 }}>
              {rows.map((r, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '7px 12px', borderBottom: i < rows.length - 1 ? '1px solid #F1F5F9' : 'none' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: '#334155', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.t.equipmentLabel}</div>
                    <div style={{ fontSize: 11, color: '#94A3B8' }}>{FREQ_LABEL[r.t.frequency] || r.t.frequency} · {r.t.checklist.length} checkpoint{r.t.checklist.length === 1 ? '' : 's'}</div>
                  </div>
                  {r.match
                    ? <span style={{ fontSize: 11, fontWeight: 700, color: '#16A34A', whiteSpace: 'nowrap' }}>✓ {r.match.asset.identification_mark || r.match.asset.name}{r.match.via === 'name' ? ' (name)' : ''}</span>
                    : <span style={{ fontSize: 11, fontWeight: 700, color: '#B45309', whiteSpace: 'nowrap' }}>⚠ not in FAR</span>}
                </div>
              ))}
              {rows.length === 0 && <div style={{ padding: 16, textAlign: 'center', color: '#94A3B8', fontSize: 13 }}>Nothing new to schedule.</div>}
            </div>

            {unmatched.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div style={{ ...label, color: '#B45309' }}>Justification for {unmatched.length} equipment not in FAR *</div>
                <textarea value={justification} onChange={e => setJustification(e.target.value)} rows={2} placeholder="e.g. Newly installed; FAR upload pending; parser missed these — admin will reconcile." style={{ ...input, width: '100%', resize: 'vertical' }} />
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button onClick={reset} style={btnGhost}>Back</button>
              <button onClick={confirm} disabled={!rows.length || !plantIds.length} style={{ ...btnPrimary, flex: 1, opacity: (rows.length && plantIds.length) ? 1 : 0.5 }}>Create {totalToCreate} schedule{totalToCreate === 1 ? '' : 's'}</button>
            </div>
          </div>
        )}

        {stage === 'saving' && <div style={{ fontSize: 13, color: '#475569', padding: '20px 0' }}>Creating schedules…</div>}
        {stage === 'done' && (<div><div style={{ fontSize: 13, color: '#16A34A', marginBottom: 14 }}>✓ Created {createdCount} recurring maintenance schedule(s).</div><button onClick={close} style={{ ...btnPrimary, width: '100%' }}>Done</button></div>)}
        {stage === 'error' && (<div><div style={{ fontSize: 13, color: '#DC2626', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: 10, marginBottom: 12 }}>{err}</div><div style={{ display: 'flex', gap: 8 }}><button onClick={() => setStage(templates.length ? 'review' : 'form')} style={{ ...btnGhost, flex: 1 }}>Back</button><button onClick={close} style={{ ...btnPrimary, flex: 1 }}>Close</button></div></div>)}
      </div>
    </div>
  );
}
