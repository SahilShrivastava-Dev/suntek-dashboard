import React, { useState, useEffect } from 'react';
import { supabase } from '../../../lib/supabase';
import { insertRows } from '../../../lib/db';
import { SlidePanel, PanelField, PanelInput, PanelSelect, PanelRow, PanelDivider, OcrUpload, PanelFooter } from '../../../components/SlidePanel';
import { KpiInfoButton } from '../../../components/KpiInfoButton';
import { useToast } from '../../../components/ui/toast';
import { SkeletonRows, ErrorState } from '../../../components/ui/states';
import type { Database } from '../../../lib/database.types';

type AssetRow = Database['public']['Tables']['fixed_assets']['Row'] & { plants?: { name: string | null } | null };

function PicBadge({ has }: { has: boolean }) {
  return (
    <span
      className={`pic-badge${has ? '' : ' missing'}`}
      title={has ? 'Pic on file' : 'No pic yet'}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
        <circle cx="12" cy="13" r="4"/>
      </svg>
    </span>
  );
}

const PLANTS = ['SHD', 'Rehla', 'Ganjam', 'HQ'];
const ACCOUNT_HEADS = ['Plant & Machinery', 'Electrical Equipment', 'Vehicles', 'Furniture & Fixtures', 'Computer & Peripherals', 'Office Equipment'];

export function FAR() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [dbPlants, setDbPlants] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const today = new Date().toISOString().split('T')[0];
  const [form, setForm] = useState({
    mark: '', model: '', capacity: '', origin: 'India',
    year: new Date().getFullYear().toString(),
    value: '', invoice: '', purchaseDate: today,
    account: 'Plant & Machinery', plant: 'SHD',
  });

  async function load() {
    try {
      const { data: plantsData } = await supabase.from('plants').select('id, name')
        .returns<{ id: string; name: string }[]>();
      if (plantsData && plantsData.length > 0) setDbPlants(plantsData);

      const { data, error } = await supabase
        .from('fixed_assets')
        .select('*, plants(name)')
        .order('created_at', { ascending: false })
        .returns<AssetRow[]>();
      if (error) throw error;
      setAssets(data || []);
      setLoadError(false);
    } catch (err) {
      console.error('[FAR] load failed', err);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const plantNames = dbPlants.length > 0 ? dbPlants.map(p => p.name) : PLANTS;

  function set(k: string, v: string) { setForm(f => ({ ...f, [k]: v })); }

  function handleOcr(data: Record<string, string>) {
    setForm(f => ({
      ...f,
      ...(data.invoice  ? { invoice: data.invoice }     : {}),
      ...(data.value    ? { value: data.value }          : {}),
      ...(data.model    ? { model: data.model }          : {}),
      ...(data.capacity ? { capacity: data.capacity }    : {}),
      ...(data.purchaseDate ? { purchaseDate: data.purchaseDate } : {}),
      // Auto-fill identification mark from model if not already set
      ...(data.model && !f.mark ? { mark: data.model } : {}),
    }));
  }

  async function handleSave() {
    if (!form.mark.trim() || !form.model.trim()) return;
    const plant = dbPlants.find(p => p.name === form.plant);
    const plantId = plant?.id || dbPlants[0]?.id || null;
    const { data, error } = await insertRows('fixed_assets', {
      plant_id: plantId,
      name: form.mark,
      identification_mark: form.mark,
      model: form.model || null,
      capacity: form.capacity || null,
      origin: form.origin || null,
      year: parseInt(form.year) || null,
      value: form.value ? parseFloat(form.value.replace(/[^0-9.]/g, '')) : null,
      invoice_no: form.invoice || null,
      purchase_date: form.purchaseDate || null,
      account_head: form.account || null,
    }).select('*, plants(name)').single();

    if (error) {
      toast.error(`Save failed: ${error.message}`);
      return;
    }
    if (data) setAssets(prev => [data as AssetRow, ...prev]);
    setSaved(true);
    setTimeout(() => { setOpen(false); setSaved(false); setForm({ mark: '', model: '', capacity: '', origin: 'India', year: new Date().getFullYear().toString(), value: '', invoice: '', purchaseDate: today, account: 'Plant & Machinery', plant: 'SHD' }); }, 1600);
  }

  function handleClose() { setOpen(false); setSaved(false); }

  return (
    <>
      {/* KPI row */}
      <div className="grid grid-cols-12 gap-5 mb-5">
        <div className="col-span-12 lg:col-span-3 card p-5" style={{ position: 'relative' }}>
          <KpiInfoButton info={{ title: 'Total Fixed Assets', what: 'Count of all capitalised fixed assets registered across all 4 factory plants (SHD, Rehla, Ganjam, HQ). Each asset is named and tracked in the FAR.', source: 'Form entry', formLabel: 'Add Asset form', formPath: '/dashboard/purchase/far', note: 'Stored in FAR_DATA mock; future target: Supabase fixed_assets table.' }} />
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">Total fixed assets</div>
          <div className="text-[28px] font-extrabold mt-1 num">{assets.length}</div>
          <div className="text-[11px] text-slate-500 mt-1">across 4 factories</div>
        </div>
        <div className="col-span-12 lg:col-span-3 card p-5" style={{ position: 'relative' }}>
          <KpiInfoButton info={{ title: 'Insurance Coverage', what: 'Total insured value of all assets listed on the Fixed Asset Register. Assets must be individually named on the FAR to be covered by the marine/fire insurance policy.', source: 'Form entry', formLabel: 'Add Asset form', formPath: '/dashboard/purchase/far', note: 'Each asset\'s invoice value is summed from the FAR entries.' }} />
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">Insurance coverage</div>
          <div className="text-[28px] font-extrabold mt-1 num">₹ 38.4 Cr</div>
          <div className="text-[11px] text-green-600 mt-1">all named on FAR</div>
        </div>
        <div className="col-span-12 lg:col-span-3 card p-5" style={{ position: 'relative' }}>
          <KpiInfoButton info={{ title: 'Assets Flagged for Repair', what: 'Count of fixed assets that have been flagged as requiring repair or maintenance and are awaiting resolution. High count = production downtime risk.', source: 'Form entry', formLabel: 'Add Asset form', formPath: '/dashboard/purchase/far', note: 'Assets with repair flag set in FAR_DATA.' }} />
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">Repair flagged</div>
          <div className="text-[28px] font-extrabold mt-1 num text-amber-600">3</div>
          <div className="text-[11px] text-amber-600 mt-1">awaiting closure</div>
        </div>
        <div className="col-span-12 lg:col-span-3 card p-5" style={{ position: 'relative' }}>
          <KpiInfoButton info={{ title: 'Pic-Proof Coverage', what: 'Percentage of registered assets that have a photo on file as proof of existence. Required for insurance claims and audits. Target 100%.', source: 'Form entry', formLabel: 'Add Asset form (OCR upload)', formPath: '/dashboard/purchase/far', note: 'Photo attached during asset registration via the OCR uploader in the slide panel.' }} />
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">Pic-proof coverage</div>
          <div className="text-[28px] font-extrabold mt-1 num">95%</div>
          <div className="progress mt-2"><div style={{ width: '95%' }}></div></div>
        </div>
      </div>

      {/* FAR table — amber-soft */}
      <div className="card p-6" style={{ background: 'var(--amber-soft)', border: '1px solid #fde68a', position: 'relative' }}>
        <KpiInfoButton info={{ title: 'Fixed Asset Register (FAR)', what: 'Complete list of all capitalized fixed assets across 4 plants. Each asset must be individually named on the FAR to be covered by the marine/fire insurance policy. Photo proof required for audit. New assets added via the "+ Add asset" slide panel.', source: 'Form entry', formLabel: '+ Add asset form', formPath: '/dashboard/purchase/far', note: 'Data from FAR_DATA mock (mockData.ts). Future: Supabase fixed_assets table.' }} />
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div>
            <div className="text-base font-bold">Fixed Asset Register</div>
            <div className="text-xs text-slate-500">Each asset is named — used in insurance · pic proof on file</div>
          </div>
          <button className="btn-accent pill px-4 py-2 font-semibold text-sm" onClick={() => setOpen(true)}>
            + Register asset
          </button>
        </div>
        {loadError ? (
          <ErrorState
            title="Couldn't load the asset register"
            message="The fixed-asset records failed to load."
            onRetry={() => { setLoading(true); setLoadError(false); load(); }}
          />
        ) : loading ? (
          <SkeletonRows rows={6} />
        ) : (
        <div className="overflow-x-auto scroll-x">
          <table className="dt">
            <thead>
              <tr>
                <th>Sl no</th>
                <th>Identification mark</th>
                <th>Model</th>
                <th className="num">Capacity</th>
                <th>Origin</th>
                <th className="num">Year</th>
                <th className="num">Taxable value</th>
                <th>Invoice no</th>
                <th>Date of purchase</th>
                <th>Account head</th>
                <th>Pic</th>
              </tr>
            </thead>
            <tbody>
              {assets.map((f, i) => (
                <tr key={f.id} style={{ cursor: 'pointer' }}>
                  <td className="num">{i + 1}</td>
                  <td className="font-semibold text-slate-700">{f.identification_mark || f.name}</td>
                  <td>{f.model || '—'}</td>
                  <td className="num">{f.capacity || '—'}</td>
                  <td>{f.origin || '—'}</td>
                  <td className="num">{f.year || '—'}</td>
                  <td className="num font-semibold">{f.value ? `₹ ${Number(f.value).toLocaleString('en-IN')}` : '—'}</td>
                  <td className="text-slate-500">{f.invoice_no || '—'}</td>
                  <td className="text-slate-500">{f.purchase_date || '—'}</td>
                  <td className="text-slate-500">{f.account_head || '—'}</td>
                  <td><PicBadge has={!!f.photo_url} /></td>
                </tr>
              ))}
              {assets.length === 0 && (
                <tr><td colSpan={11} className="text-center text-slate-400 py-6 text-sm">No assets registered yet — add the first one</td></tr>
              )}
            </tbody>
          </table>
        </div>
        )}
      </div>

      {/* Slide panel */}
      <SlidePanel open={open} onClose={handleClose} title="Register fixed asset" subtitle="FAR · Purchase">
        <PanelField label="Identification mark *">
          <PanelInput placeholder="e.g. SCPL-PM-047, SHD-Compressor-3" value={form.mark} onChange={e => set('mark', e.target.value)} />
        </PanelField>

        <PanelRow>
          <PanelField label="Model *">
            <PanelInput placeholder="e.g. Atlas Copco GA-22" value={form.model} onChange={e => set('model', e.target.value)} />
          </PanelField>
          <PanelField label="Capacity">
            <PanelInput placeholder="e.g. 5 MT, 22 kW" value={form.capacity} onChange={e => set('capacity', e.target.value)} />
          </PanelField>
        </PanelRow>

        <PanelRow>
          <PanelField label="Origin">
            <PanelSelect value={form.origin} onChange={e => set('origin', e.target.value)}>
              <option>India</option>
              <option>Import</option>
            </PanelSelect>
          </PanelField>
          <PanelField label="Year of purchase">
            <PanelInput type="number" value={form.year} onChange={e => set('year', e.target.value)} />
          </PanelField>
        </PanelRow>

        <PanelRow>
          <PanelField label="Taxable value (₹)">
            <PanelInput placeholder="e.g. ₹ 4,20,000" value={form.value} onChange={e => set('value', e.target.value)} />
          </PanelField>
          <PanelField label="Invoice no">
            <PanelInput placeholder="e.g. INV-2024-1234" value={form.invoice} onChange={e => set('invoice', e.target.value)} />
          </PanelField>
        </PanelRow>

        <PanelRow>
          <PanelField label="Date of purchase">
            <PanelInput type="date" value={form.purchaseDate} onChange={e => set('purchaseDate', e.target.value)} />
          </PanelField>
          <PanelField label="Plant">
            <PanelSelect value={form.plant} onChange={e => set('plant', e.target.value)}>
              {plantNames.map(p => <option key={p}>{p}</option>)}
            </PanelSelect>
          </PanelField>
        </PanelRow>

        <PanelField label="Account head">
          <PanelSelect value={form.account} onChange={e => set('account', e.target.value)}>
            {ACCOUNT_HEADS.map(a => <option key={a}>{a}</option>)}
          </PanelSelect>
        </PanelField>

        <PanelDivider />

        <OcrUpload
          label="Invoice / asset photo"
          hint="Upload purchase invoice — AI reads invoice no, model, value, date"
          fields={[
            { key: 'invoice',      label: 'Invoice No',       value: 'INV-2026-7234' },
            { key: 'model',        label: 'Model / Make',     value: 'Atlas Copco GA18' },
            { key: 'capacity',     label: 'Capacity / Specs', value: '18 kW / 10 bar' },
            { key: 'value',        label: 'Taxable Value (₹)', value: '3,85,000' },
            { key: 'purchaseDate', label: 'Invoice Date',      value: new Date().toISOString().slice(0, 10) },
          ]}
          onExtracted={handleOcr}
        />

        <PanelFooter
          saved={saved}
          onCancel={handleClose}
          onSave={handleSave}
          saveLabel="Register asset"
          successLabel="Asset registered"
          successSub="Added to FAR · insurance coverage updated"
          disabled={!form.mark.trim() || !form.model.trim()}
          requiredHint="Fill in Identification mark and Model to register"
        />
      </SlidePanel>
    </>
  );
}
