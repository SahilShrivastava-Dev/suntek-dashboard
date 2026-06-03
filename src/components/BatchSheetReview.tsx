/**
 * BatchSheetReview
 *
 * Shown in the right panel of BatchLogger when an image has been extracted.
 * Left side: the original photo  |  Right side: all extracted fields, fully editable.
 *
 * Props:
 *   data       — raw AI extraction (ExtractedBatchSheet)
 *   imageUrl   — object URL of the uploaded image (for display)
 *   batches    — existing active_batches list (for matching batch_no → id)
 *   ipAddress  — for audit log
 *   onSaved    — called with batchNo after successful DB save
 *   onCancel   — called when user discards
 */
import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  parsePressureToKg,
  parseBatchTimestamp,
  type ExtractedBatchSheet,
  type BatchReadingExtracted,
} from '../lib/nvidiaOcr';

// ── Types ─────────────────────────────────────────────────────────────────────

interface EditableReading extends BatchReadingExtracted {
  _key: string;
}

interface BatchSheetReviewProps {
  data: ExtractedBatchSheet;
  imageUrl: string;
  batches: any[];
  ipAddress?: string;
  onSaved: (batchNo: string) => void;
  onCancel: () => void;
  /** When true, all fields are read-only and cannot be edited (Purchase sheet anti-tampering rule). */
  readOnly?: boolean;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function BatchSheetReview({
  data,
  imageUrl,
  batches,
  ipAddress,
  onSaved,
  onCancel,
  readOnly = false,
}: BatchSheetReviewProps) {

  // ── Header fields ─────────────────────────────────────────────────────────
  const [batchNo, setBatchNo]           = useState(data.batchNo ?? '');
  const [finalGravity, setFinalGravity] = useState(data.finalGravity != null ? String(data.finalGravity) : '');
  const [typeOfOil, setTypeOfOil]       = useState(data.summary?.typeOfOil ?? '');
  const [totalBatchTime, setTotalBatchTime] = useState(data.processInfo?.totalBatchTime ?? '');

  // ── Summary fields ────────────────────────────────────────────────────────
  const [paraffinWeight, setParaffinWeight] = useState(
    data.summary?.paraffinWeight != null ? String(data.summary.paraffinWeight) : ''
  );
  const [hclQty, setHclQty]         = useState(
    data.summary?.hclQuantity != null ? String(data.summary.hclQuantity) : ''
  );
  const [totalDrums, setTotalDrums] = useState(
    data.summary?.totalDrumsFilled != null ? String(data.summary.totalDrumsFilled) : ''
  );
  const [openingBal, setOpeningBal] = useState(
    data.summary?.openingBalance != null ? String(data.summary.openingBalance) : ''
  );
  const [operator, setOperator]     = useState(data.summary?.operator ?? '');
  const [helper, setHelper]         = useState(data.summary?.helper ?? '');
  const [melterNo, setMelterNo]     = useState(data.summary?.melterNo ?? '');
  const [degasserNo, setDegasserNo] = useState(data.summary?.degasserNo ?? '');

  // ── Readings table ────────────────────────────────────────────────────────
  const [readings, setReadings] = useState<EditableReading[]>(
    (data.readings ?? []).map((r, i) => ({ ...r, _key: `r-${i}` }))
  );

  // ── Saving state ──────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // ── Reading row helpers ───────────────────────────────────────────────────

  const updateReading = (key: string, field: keyof BatchReadingExtracted, raw: string) => {
    setReadings(prev => prev.map(r => {
      if (r._key !== key) return r;
      if (field === 'temp' || field === 'cpGravity' || field === 'hclGravity') {
        return { ...r, [field]: raw === '' ? null : parseFloat(raw) };
      }
      return { ...r, [field]: raw === '' ? null : raw };
    }));
  };

  const deleteReading = (key: string) =>
    setReadings(prev => prev.filter(r => r._key !== key));

  const addRow = () =>
    setReadings(prev => [...prev, {
      _key: `new-${Date.now()}`, date: '', time: '', temp: null,
      cpGravity: null, cl2Pressure: null, cl2PipeLinePressure: null,
      hclGravity: null, operator: null,
    }]);

  // ── Save ─────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!batchNo) { alert('Batch number is required.'); return; }
    setSaving(true);
    setSaveError(null);

    try {
      const fgNum    = finalGravity ? parseFloat(finalGravity) : null;
      const drumsNum = totalDrums   ? parseInt(totalDrums)     : null;
      const parfNum  = paraffinWeight ? parseFloat(paraffinWeight) : null;
      const hclNum   = hclQty       ? parseFloat(hclQty)       : null;

      // 1. Find or create active_batches record
      let batchId: string | null = null;
      const existing = batches.find(b => String(b.batch_no) === String(batchNo) && !b.id?.startsWith('mock-'));

      if (existing) {
        batchId = existing.id;
        await (supabase.from('active_batches') as any).update({
          final_gravity: fgNum,
          total_drums: drumsNum,
          paraffin_weight: parfNum,
          hcl_quantity: hclNum,
        }).eq('id', batchId);
      } else {
        const { data: nb, error: e } = await (supabase.from('active_batches') as any)
          .insert({
            batch_no: batchNo,
            recipe: typeOfOil || 'Unknown',
            target_qty: 0,
            status: 'closed',
            final_gravity: fgNum,
            total_drums: drumsNum,
            paraffin_weight: parfNum,
            hcl_quantity: hclNum,
          }).select().single();
        if (e) throw e;
        batchId = nb.id;
      }
      if (!batchId) throw new Error('Could not resolve batch ID');

      // 2. Insert all readings
      const toInsert = readings
        .filter(r => r.date || r.time || r.temp != null || r.cpGravity != null)
        .map(r => ({
          batch_id: batchId,
          timestamp: parseBatchTimestamp(r.date ?? '', r.time ?? ''),
          temp: r.temp,
          cp_gravity: r.cpGravity,
          cl2_pressure: parsePressureToKg(r.cl2Pressure),
          hcl_gravity: r.hclGravity,
          cl2_pipe_pressure: parsePressureToKg(r.cl2PipeLinePressure),
        }));

      if (toInsert.length > 0) {
        const { error: re } = await (supabase.from('batch_readings') as any).insert(toInsert);
        if (re) throw re;
      }

      // 3. Audit log
      await (supabase.from('batch_edit_logs') as any).insert({
        ip_address: ipAddress ?? 'unknown',
        batch_no: batchNo,
        action_type: 'sheet_upload',
        details: {
          readings_count: toInsert.length,
          final_gravity: fgNum,
          total_drums: drumsNum,
          paraffin_weight: parfNum,
          hcl_quantity: hclNum,
          type_of_oil: typeOfOil,
          operator,
          helper,
          total_batch_time: totalBatchTime,
          raw_extracted: data,
        },
        created_at: new Date().toISOString(),
      });

      onSaved(batchNo);
    } catch (e: any) {
      setSaveError(e?.message ?? String(e));
      setSaving(false);
    }
  };

  // ── Input style helper ────────────────────────────────────────────────────
  const inputCls = readOnly
    ? 'w-full p-2 border-2 border-slate-100 rounded-xl text-sm font-medium bg-slate-50 text-slate-500 cursor-not-allowed select-none'
    : 'w-full p-2 border-2 border-slate-200 rounded-xl text-sm font-medium focus:border-violet-400 focus:outline-none bg-white transition-colors';
  const labelCls = 'block text-xs font-bold text-slate-400 uppercase tracking-wide mb-1';

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-white rounded-2xl shadow-sm overflow-hidden">

      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <div
        className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 shrink-0"
        style={{
          background: readOnly
            ? 'linear-gradient(to right, #fef2f2, #fff7ed)'
            : 'linear-gradient(to right, #f5f3ff, #f8fafc)',
        }}
      >
        <div className="flex items-center gap-2">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ background: readOnly ? '#fee2e2' : '#ede9fe' }}
          >
            {readOnly ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2.5">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="2.5">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
            )}
          </div>
          <div>
            <div className="text-sm font-bold text-slate-800">
              {readOnly ? 'Purchase Sheet — Locked (Read-Only)' : 'OCR Extraction — Review & Confirm'}
            </div>
            <div className="text-xs" style={{ color: readOnly ? '#dc2626' : '#94a3b8' }}>
              {readOnly
                ? 'Purchase data is strictly immutable after upload — no editing permitted'
                : `${readings.length} readings detected · Edit any cell before saving`}
            </div>
          </div>
        </div>
        <button
          onClick={onCancel}
          className="text-xs font-bold text-slate-400 hover:text-slate-600 transition px-2 py-1 rounded-lg hover:bg-slate-100"
        >
          ✕ Cancel
        </button>
      </div>

      {/* ── Body: image left + form right ─────────────────────────────────── */}
      <div className="flex-1 overflow-hidden flex">

        {/* LEFT: Original image */}
        <div
          className="shrink-0 overflow-auto border-r border-slate-100 bg-slate-50 flex flex-col items-center p-3 gap-2"
          style={{ width: 220 }}
        >
          <div className="text-xs font-bold text-slate-400 uppercase tracking-wide self-start">Original Sheet</div>
          <img
            src={imageUrl}
            alt="Batch sheet original"
            className="w-full rounded-xl shadow-sm border border-slate-200 object-contain"
            style={{ maxHeight: '100%' }}
          />
        </div>

        {/* RIGHT: Extracted data — scrollable */}
        <div className="flex-1 overflow-auto p-5 space-y-5">

          {/* ── Header fields ─────────────────────────────────────────────── */}
          <div>
            <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Batch Header</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className={labelCls}>Batch No. *</label>
                <input type="text" value={batchNo} onChange={e => !readOnly && setBatchNo(e.target.value)}
                  readOnly={readOnly} className={inputCls + ' font-bold text-base'} placeholder="1228" />
              </div>
              <div>
                <label className={labelCls}>Final Gravity</label>
                <input type="number" value={finalGravity} onChange={e => !readOnly && setFinalGravity(e.target.value)}
                  readOnly={readOnly} className={inputCls} placeholder="1390" />
              </div>
              <div>
                <label className={labelCls}>Type of Oil</label>
                <input type="text" value={typeOfOil} onChange={e => !readOnly && setTypeOfOil(e.target.value)}
                  readOnly={readOnly} className={inputCls} placeholder="N.P" />
              </div>
              <div>
                <label className={labelCls}>Total Batch Time</label>
                <input type="text" value={totalBatchTime} onChange={e => !readOnly && setTotalBatchTime(e.target.value)}
                  readOnly={readOnly} className={inputCls} placeholder="52h45m" />
              </div>
            </div>
          </div>

          {/* ── Summary fields ─────────────────────────────────────────────── */}
          <div>
            <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Batch Summary</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'Paraffin Wt. (kg)', val: paraffinWeight, set: setParaffinWeight, ph: '2200', type: 'number' },
                { label: 'HCL Qty (M.T)',      val: hclQty,         set: setHclQty,         ph: '12',   type: 'number' },
                { label: 'Total Drums',         val: totalDrums,     set: setTotalDrums,     ph: '32',   type: 'number' },
                { label: 'Opening Balance',     val: openingBal,     set: setOpeningBal,     ph: '900',  type: 'number' },
                { label: 'Melter No.',          val: melterNo,       set: setMelterNo,       ph: '4',    type: 'text'   },
                { label: 'Degasser No.',        val: degasserNo,     set: setDegasserNo,     ph: '1',    type: 'text'   },
                { label: 'Operator',            val: operator,       set: setOperator,       ph: 'Name', type: 'text'   },
                { label: 'Helper',              val: helper,         set: setHelper,         ph: 'Name', type: 'text'   },
              ].map(({ label, val, set, ph, type }) => (
                <div key={label}>
                  <label className={labelCls}>{label}</label>
                  <input type={type} value={val} onChange={e => !readOnly && set(e.target.value)}
                    readOnly={readOnly} className={inputCls} placeholder={ph} />
                </div>
              ))}
            </div>
          </div>

          {/* ── Process info (read-only) ─────────────────────────────────── */}
          {data.processInfo && Object.values(data.processInfo).some(v => v != null && v !== '') && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
              <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">
                Process Info <span className="font-normal normal-case text-slate-300">(stored in audit log)</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-1 text-xs">
                {Object.entries(data.processInfo)
                  .filter(([, v]) => v != null && v !== '')
                  .map(([k, v]) => (
                    <div key={k} className="flex gap-1.5">
                      <span className="text-slate-400 font-semibold capitalize">
                        {k.replace(/([A-Z])/g, ' $1').trim()}:
                      </span>
                      <span className="font-mono text-slate-600">{String(v)}</span>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* ── Readings table ───────────────────────────────────────────── */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                Hourly Readings
                <span className="ml-2 px-2 py-0.5 bg-violet-100 text-violet-700 rounded-full font-bold text-xs normal-case">
                  {readings.length} rows
                </span>
                {readOnly && (
                  <span className="ml-2 px-2 py-0.5 bg-red-100 text-red-600 rounded-full font-bold text-xs normal-case">
                    locked
                  </span>
                )}
              </div>
              {!readOnly && (
                <button
                  onClick={addRow}
                  className="text-xs font-bold text-violet-600 hover:text-violet-800 transition flex items-center gap-1"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  Add Row
                </button>
              )}
            </div>

            {readings.length === 0 ? (
              <div className="text-center py-8 text-sm text-slate-400 border-2 border-dashed border-slate-200 rounded-xl">
                No readings extracted. Add rows manually or try re-uploading a clearer photo.
              </div>
            ) : (
              <div className="rounded-xl border border-slate-200 overflow-auto">
                <table className="w-full text-xs border-collapse" style={{ minWidth: 720 }}>
                  <thead className="bg-slate-50 sticky top-0">
                    <tr className="text-slate-500 font-bold uppercase tracking-wide border-b border-slate-200">
                      {['Date', 'Time', 'Temp °C', 'CP Gravity', 'Cl₂ Press.', 'Pipe Press.', 'HCL Gravity', 'Operator', ...(readOnly ? [] : [''])].map(h => (
                        <th key={h} className="px-2 py-2 text-left font-bold whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {readings.map((r, idx) => (
                      <tr
                        key={r._key}
                        className="border-b border-slate-100 hover:bg-violet-50/30 transition-colors"
                        style={{ background: idx % 2 === 0 ? undefined : '#fafafa' }}
                      >
                        {(
                          [
                            ['date',               r.date ?? '',             'text',   '22/02/26'],
                            ['time',               r.time ?? '',             'text',   '10 PM'],
                            ['temp',               r.temp != null ? String(r.temp) : '',           'number', '101'],
                            ['cpGravity',          r.cpGravity != null ? String(r.cpGravity) : '', 'number', '910'],
                            ['cl2Pressure',        r.cl2Pressure ?? '',      'text',   '1.1kg'],
                            ['cl2PipeLinePressure',r.cl2PipeLinePressure ?? '','text', '2kg'],
                            ['hclGravity',         r.hclGravity != null ? String(r.hclGravity) : '', 'number', '1140'],
                            ['operator',           r.operator ?? '',         'text',   'Name'],
                          ] as [keyof BatchReadingExtracted, string, string, string][]
                        ).map(([field, val, type, ph]) => (
                          <td key={field} className="px-1 py-1">
                            <input
                              type={type}
                              value={val}
                              onChange={e => !readOnly && updateReading(r._key, field, e.target.value)}
                              readOnly={readOnly}
                              placeholder={ph}
                              className={
                                readOnly
                                  ? 'w-full min-w-[52px] px-2 py-1.5 rounded-lg text-xs font-mono bg-slate-50 text-slate-500 cursor-not-allowed border border-transparent'
                                  : 'w-full min-w-[52px] px-2 py-1.5 border border-transparent rounded-lg text-xs font-mono focus:border-violet-300 focus:bg-white focus:outline-none hover:border-slate-200 transition-colors'
                              }
                            />
                          </td>
                        ))}
                        {!readOnly && (
                          <td className="px-1 py-1 text-center">
                            <button
                              onClick={() => deleteReading(r._key)}
                              title="Remove row"
                              className="w-6 h-6 flex items-center justify-center rounded-md text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                              </svg>
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {saveError && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-600 break-words">
              <span className="font-bold">Save failed: </span>{saveError}
            </div>
          )}

        </div>
      </div>

      {/* ── Footer action bar ─────────────────────────────────────────────── */}
      <div className="px-5 py-3.5 border-t border-slate-100 bg-slate-50 flex items-center gap-3 shrink-0">
        <button
          onClick={onCancel}
          className="py-2.5 px-4 rounded-xl border-2 border-slate-200 text-sm font-bold text-slate-500 hover:bg-slate-100 transition whitespace-nowrap"
        >
          ↩ Re-upload
        </button>

        <div className="flex-1 text-xs text-slate-400 text-center">
          {readings.length} readings · Batch #{batchNo || '—'} · Final Gravity {finalGravity || '—'}
        </div>

        {readOnly ? (
          <div
            className="py-2.5 px-5 rounded-xl text-sm font-bold flex items-center gap-2"
            style={{ background: '#fee2e2', color: '#dc2626' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
            Locked — Cannot Edit
          </div>
        ) : (
          <button
            onClick={handleSave}
            disabled={saving || !batchNo}
            className="py-2.5 px-6 rounded-xl text-sm font-bold text-white transition whitespace-nowrap flex items-center gap-2 disabled:opacity-50"
            style={{
              background: saving || !batchNo ? '#94a3b8' : '#2563EB',
              boxShadow: saving || !batchNo ? 'none' : '0 6px 16px -4px rgba(37,99,235,0.4)',
            }}
          >
            {saving ? (
              <>
                <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="rgba(255,255,255,0.3)" strokeWidth="3" />
                  <path d="M12 2 A10 10 0 0 1 22 12" stroke="white" strokeWidth="3" strokeLinecap="round" />
                </svg>
                Saving…
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Save {readings.filter(r => r.date || r.cpGravity != null).length} Readings to DB
              </>
            )}
          </button>
        )}
      </div>

    </div>
  );
}
