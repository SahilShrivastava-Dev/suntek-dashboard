import React, { useState, useEffect } from 'react';
import { supabase } from '../../../lib/supabase';
import { SlidePanel, PanelField, PanelInput, PanelSelect, PanelTextarea, PanelRow, PanelDivider, OcrUpload, PanelFooter } from '../../../components/SlidePanel';
import { KpiInfoButton } from '../../../components/KpiInfoButton';

function PicBadge({ has }: { has: boolean }) {
  return (
    <span className={`pic-badge${has ? '' : ' missing'}`} title={has ? 'Pic on file' : 'No pic yet'}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
        <circle cx="12" cy="13" r="4"/>
      </svg>
    </span>
  );
}

const PLANTS = ['SHD', 'Rehla', 'Ganjam', 'HQ'];

export function ActivityLog() {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [logs, setLogs] = useState<any[]>([]);
  const [dbPlants, setDbPlants] = useState<{ id: string; name: string }[]>([]);
  const today = new Date().toISOString().split('T')[0];
  const [form, setForm] = useState({ equipment: '', type: 'Regular', date: today, doneBy: '', verifiedBy: '', plant: 'SHD', notes: '' });

  useEffect(() => {
    async function load() {
      const { data: plantsData } = await (supabase.from('plants').select('id, name') as any);
      if (plantsData && plantsData.length > 0) setDbPlants(plantsData);

      const { data } = await (supabase
        .from('activity_logs')
        .select('*, plants(name)')
        .order('date', { ascending: false }) as any);
      setLogs(data || []);
    }
    load();
  }, []);

  const plantNames = dbPlants.length > 0 ? dbPlants.map(p => p.name) : PLANTS;

  function set(k: string, v: string) { setForm(f => ({ ...f, [k]: v })); }

  async function handleSave() {
    if (!form.equipment.trim() || !form.doneBy.trim()) return;
    const plant = dbPlants.find(p => p.name === form.plant);
    const { data, error } = await (supabase.from('activity_logs').insert({
      equipment: form.equipment,
      type: form.type.toLowerCase(),
      date: form.date,
      done_by: form.doneBy,
      verified_by: form.verifiedBy || null,
      plant_id: plant?.id || null,
    }).select('*, plants(name)').single() as any);

    if (error) {
      alert(`Save failed: ${error.message}`);
      return;
    }
    if (data) setLogs(prev => [data, ...prev]);
    setSaved(true);
    setTimeout(() => { setOpen(false); setSaved(false); setForm({ equipment: '', type: 'Regular', date: today, doneBy: '', verifiedBy: '', plant: 'SHD', notes: '' }); }, 1600);
  }

  function handleClose() { setOpen(false); setSaved(false); }

  return (
    <>
      {/* KPI row */}
      <div className="grid grid-cols-12 gap-5 mb-5">
        <div className="col-span-12 lg:col-span-3 card p-5" style={{ position: 'relative' }}>
          <KpiInfoButton info={{ title: 'Activities This Week', what: 'Count of non-regular maintenance activities logged this week across all plants — repairs, inspections, new installations, etc. Only unscheduled/ad-hoc activities; routine maintenance is separate.', source: 'Form entry', formLabel: '+ Log activity form', formPath: '/dashboard/purchase/activity' }} />
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">Activities · total</div>
          <div className="text-[28px] font-extrabold mt-1 num">{logs.length}</div>
          <div className="text-[11px] text-slate-500 mt-1">non-maintenance</div>
        </div>
        <div className="col-span-12 lg:col-span-3 card p-5" style={{ position: 'relative' }}>
          <KpiInfoButton info={{ title: 'Activities Verified', what: 'Count of logged activities that have been verified by a supervisor or manager. Verification confirms work was completed correctly and photo proof reviewed.', source: 'Form entry', formLabel: '+ Log activity form', formPath: '/dashboard/purchase/activity', note: 'Verified by field set in ACTIVITY mock data.' }} />
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">Verified</div>
          <div className="text-[28px] font-extrabold mt-1 num text-green-600">{logs.filter(l => l.verified_by).length}</div>
        </div>
        <div className="col-span-12 lg:col-span-3 card p-5" style={{ position: 'relative' }}>
          <KpiInfoButton info={{ title: 'Pending Verification', what: 'Activities logged but not yet verified. These need supervisor sign-off. High pending count = verification backlog.', source: 'Form entry', formLabel: '+ Log activity form', formPath: '/dashboard/purchase/activity' }} />
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">Pending verification</div>
          <div className="text-[28px] font-extrabold mt-1 num text-amber-600">{logs.filter(l => !l.verified_by).length}</div>
        </div>
        <div className="col-span-12 lg:col-span-3 card p-5" style={{ position: 'relative' }}>
          <KpiInfoButton info={{ title: 'Photo Proof Coverage', what: 'Percentage of logged activities that have a photographic proof attached. Photos are saved to OneDrive. 100% is required for audit compliance.', source: 'Form entry', formLabel: '+ Log activity form (OCR upload)', formPath: '/dashboard/purchase/activity', note: 'Photo uploaded at the time of logging; stored in OneDrive, not Supabase.' }} />
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">With photo proof</div>
          <div className="text-[28px] font-extrabold mt-1 num">
            {logs.length > 0 ? Math.round((logs.filter(l => l.photo_url).length / logs.length) * 100) : 0}%
          </div>
        </div>
      </div>

      {/* Table — amber-soft */}
      <div className="card p-6" style={{ background: 'var(--amber-soft)', border: '1px solid #fde68a', position: 'relative' }}>
        <KpiInfoButton info={{ title: 'Activity Log Book', what: 'Record of all non-routine activities (repairs, inspections, installations) across all plants. Each entry requires: equipment name, who did it, date, plant, and photo proof. Photos are stored in OneDrive. New entries via "+ Log activity" form.', source: 'Form entry', formLabel: '+ Log activity form', formPath: '/dashboard/purchase/activity', note: 'Data from ACTIVITY mock (mockData.ts). Future: Supabase activity_log table.' }} />
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div>
            <div className="text-base font-bold">Activity log book</div>
            <div className="text-xs text-slate-500">Anything outside the regular maintenance schedule · photos saved to OneDrive</div>
          </div>
          <button className="btn-accent pill px-4 py-2 font-semibold text-sm" onClick={() => setOpen(true)}>
            + Log activity
          </button>
        </div>
        <div className="overflow-x-auto scroll-x">
          <table className="dt">
            <thead>
              <tr>
                <th>Equipment</th><th>Type</th><th>Date</th>
                <th>Done by</th><th>Verified by</th><th>Plant</th><th>Pic</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((a, i) => (
                <tr key={a.id || i} style={{ cursor: 'pointer' }}>
                  <td className="font-semibold">{a.equipment || '—'}</td>
                  <td className="text-slate-500">{a.type}</td>
                  <td className="text-slate-500 text-xs">{a.date}</td>
                  <td>{a.done_by || '—'}</td>
                  <td className="text-slate-500">{a.verified_by || '—'}</td>
                  <td>{a.plants?.name || '—'}</td>
                  <td><PicBadge has={!!a.photo_url} /></td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr><td colSpan={7} className="text-center text-slate-400 py-6 text-sm">No activity logs yet — add the first one</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Slide panel */}
      <SlidePanel open={open} onClose={handleClose} title="Log an activity" subtitle="Activity Log · Purchase">
        <PanelField label="Equipment / asset *">
          <PanelInput placeholder="e.g. Cooling tower motor, Air compressor" value={form.equipment} onChange={e => set('equipment', e.target.value)} />
        </PanelField>

        <PanelRow>
          <PanelField label="Activity type">
            <PanelSelect value={form.type} onChange={e => set('type', e.target.value)}>
              <option>Regular</option>
              <option>Repair</option>
              <option>Scrap</option>
              <option>Inspection</option>
              <option>Calibration</option>
            </PanelSelect>
          </PanelField>
          <PanelField label="Plant">
            <PanelSelect value={form.plant} onChange={e => set('plant', e.target.value)}>
              {plantNames.map(p => <option key={p}>{p}</option>)}
            </PanelSelect>
          </PanelField>
        </PanelRow>

        <PanelRow>
          <PanelField label="Date *">
            <PanelInput type="date" value={form.date} onChange={e => set('date', e.target.value)} />
          </PanelField>
          <PanelField label="Done by *">
            <PanelInput placeholder="Name of person" value={form.doneBy} onChange={e => set('doneBy', e.target.value)} />
          </PanelField>
        </PanelRow>

        <PanelField label="Verified by">
          <PanelInput placeholder="Supervisor / unit head (optional)" value={form.verifiedBy} onChange={e => set('verifiedBy', e.target.value)} />
        </PanelField>

        <PanelField label="Notes">
          <PanelTextarea placeholder="What was done, parts replaced, observations…" value={form.notes} onChange={e => set('notes', e.target.value)} />
        </PanelField>

        <PanelDivider />

        <OcrUpload
          label="Pic proof"
          hint="Photo of work done — AI reads equipment ID, work type, completion status"
          fields={[
            { key: 'equipment', label: 'Equipment ID',  value: 'Atlas Copco GA18 — SHD-AC-04' },
            { key: 'type',      label: 'Activity type', value: 'Repair' },
            { key: 'notes',     label: 'Work summary',  value: 'Replaced V-belt drive + tightened coupling bolts' },
          ]}
          onExtracted={data => {
            if (data.equipment) set('equipment', data.equipment);
            if (data.type)      set('type',      data.type);
            if (data.notes)     set('notes',     data.notes);
          }}
        />

        <PanelFooter
          saved={saved}
          onCancel={handleClose}
          onSave={handleSave}
          saveLabel="Save log entry"
          successLabel="Activity logged"
          successSub="Entry saved · photo uploading to OneDrive"
          disabled={!form.equipment.trim() || !form.doneBy.trim()}
          requiredHint="Fill in Equipment and Done by to save"
        />
      </SlidePanel>
    </>
  );
}
