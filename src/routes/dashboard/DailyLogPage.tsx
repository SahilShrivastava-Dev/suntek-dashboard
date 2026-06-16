/**
 * DailyLogPage
 *
 * Upload & review Unit Daily Monitoring Logs (hourly temperature/pressure/density
 * sheets like the Madan Chemicals Unit-II morning log).
 *
 * Layout:
 *   When no upload: full-width upload zone with instructions
 *   After extraction: image on left | editable extracted data on right
 *
 * Route: /dashboard/daily-log
 */
import React, { useState, useRef, useCallback } from 'react';
import { insertRows } from '../../lib/db';
import { useToast } from '../../components/ui/toast';
import {
  extractDailyLog,
  resizeImageToDataUrl,
  type ExtractedDailyLog,
  type DailyLogReading,
  type DailyLogTankSummary,
} from '../../lib/nvidiaOcr';

// ── Types ─────────────────────────────────────────────────────────────────────

type Stage = 'idle' | 'ready' | 'loading' | 'review' | 'saving' | 'done' | 'error';

interface EditableReading extends DailyLogReading {
  _key: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const COLUMN_DEFS: { key: keyof DailyLogReading; label: string; type: 'text' | 'number'; width: number }[] = [
  { key: 'time',              label: 'Time',        type: 'text',   width: 72  },
  { key: 'aux1Temp',          label: 'Aux-1 °C',    type: 'number', width: 62  },
  { key: 'aux2Temp',          label: 'Aux-2 °C',    type: 'number', width: 62  },
  { key: 'aux3Temp',          label: 'Aux-3 °C',    type: 'number', width: 62  },
  { key: 'hclPrimaryTemp',    label: 'HCL Pri.',    type: 'number', width: 62  },
  { key: 'hclSecondaryTemp',  label: 'HCL Sec.',    type: 'number', width: 62  },
  { key: 'pressureA',         label: 'Press A',     type: 'number', width: 60  },
  { key: 'pressureB',         label: 'Press B',     type: 'number', width: 60  },
  { key: 'pressureC',         label: 'Press C',     type: 'number', width: 60  },
  { key: 'pressureD',         label: 'Press D',     type: 'number', width: 60  },
  { key: 'hclDensity',        label: 'HCL Den.',    type: 'number', width: 68  },
  { key: 'cpwRfDensity',      label: 'CPW RF',      type: 'number', width: 68  },
  { key: 'cpwR6Density',      label: 'CPW R6',      type: 'number', width: 68  },
  { key: 'cpwTransferFrom',   label: 'Trans. From', type: 'text',   width: 60  },
  { key: 'cpwTransferTo',     label: 'Trans. To',   type: 'text',   width: 60  },
  { key: 'blowerOn',          label: 'Blower ON',   type: 'text',   width: 60  },
  { key: 'blowerOff',         label: 'Blower OFF',  type: 'text',   width: 60  },
  { key: 'flowMeterTop',      label: 'Flow TOP',    type: 'number', width: 62  },
  { key: 'flowMeterRa',       label: 'Flow RA',     type: 'number', width: 62  },
  { key: 'flowMeterR1',       label: 'Flow R1',     type: 'number', width: 62  },
];

function rowVal(r: EditableReading, key: keyof DailyLogReading): string {
  const v = r[key];
  return v != null ? String(v) : '';
}

// ── Component ─────────────────────────────────────────────────────────────────

export function DailyLogPage() {
  const toast = useToast();
  const [stage, setStage]           = useState<Stage>('idle');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError]           = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [doneSummary, setDoneSummary] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const apiImageRef  = useRef<string>('');

  // ── Review form state ──────────────────────────────────────────────────────
  const [rawData, setRawData]         = useState<ExtractedDailyLog | null>(null);
  const [date, setDate]               = useState('');
  const [shift, setShift]             = useState('');
  const [unitName, setUnitName]       = useState('');
  const [operators, setOperators]     = useState('');
  const [helper, setHelper]           = useState('');
  const [remarks, setRemarks]         = useState('');
  const [notesHnp, setNotesHnp]       = useState('');
  const [notesHcl, setNotesHcl]       = useState('');
  const [readings, setReadings]       = useState<EditableReading[]>([]);
  const [tankSummaries, setTankSummaries] = useState<DailyLogTankSummary[]>([
    { tankIndex: 1, shiftingToStorageTime: null, density: null, heatStabilizerQty: null, brightenerQty: null },
    { tankIndex: 2, shiftingToStorageTime: null, density: null, heatStabilizerQty: null, brightenerQty: null },
    { tankIndex: 3, shiftingToStorageTime: null, density: null, heatStabilizerQty: null, brightenerQty: null },
  ]);

  // ── File handling ──────────────────────────────────────────────────────────

  const handleFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/') && !/\.(jpe?g|png|heic|webp)$/i.test(file.name)) {
      setError('Please upload a JPG, PNG, or HEIC image.'); setStage('error'); return;
    }
    setError(null);
    setPreviewUrl(URL.createObjectURL(file));
    try {
      // 1200px is sufficient for the 11B model and keeps the base64 payload small
      apiImageRef.current = await resizeImageToDataUrl(file, 1200);
      setStage('ready');
    } catch (e) {
      setError(`Image processing failed: ${e instanceof Error ? e.message : String(e)}`); setStage('error');
    }
  }, []);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    const f = e.dataTransfer.files?.[0]; if (f) handleFile(f);
  };

  // ── Extract ────────────────────────────────────────────────────────────────

  const handleExtract = async () => {
    if (!apiImageRef.current) return;
    setStage('loading');
    try {
      const data = await extractDailyLog(apiImageRef.current);
      setRawData(data);
      setDate(data.date ?? '');
      setShift(data.shift ?? '');
      setUnitName(data.unitName ?? '');
      setOperators((data.operatorNames ?? []).join(', '));
      setHelper(data.helperName ?? '');
      setRemarks(data.remarks ?? '');
      setNotesHnp(data.notes?.hnpTank ?? '');
      setNotesHcl(data.notes?.hclTank ?? '');
      setReadings((data.readings ?? []).map((r, i) => ({ ...r, _key: `r-${i}` })));
      setTankSummaries(
        [1, 2, 3].map(idx => {
          const found = (data.tankSummaries ?? []).find(t => t.tankIndex === idx);
          return found ?? { tankIndex: idx, shiftingToStorageTime: null, density: null, heatStabilizerQty: null, brightenerQty: null };
        })
      );
      setStage('review');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e)); setStage('error');
    }
  };

  // ── Reading table helpers ──────────────────────────────────────────────────

  const updateCell = (key: string, field: keyof DailyLogReading, val: string) => {
    setReadings(prev => prev.map(r => {
      if (r._key !== key) return r;
      const numFields: (keyof DailyLogReading)[] = [
        'aux1Temp','aux2Temp','aux3Temp','hclPrimaryTemp','hclSecondaryTemp',
        'pressureA','pressureB','pressureC','pressureD',
        'hclDensity','cpwRfDensity','cpwR6Density',
        'flowMeterTop','flowMeterRa','flowMeterR1',
      ];
      if (numFields.includes(field)) {
        return { ...r, [field]: val === '' ? null : parseFloat(val) };
      }
      return { ...r, [field]: val === '' ? null : val };
    }));
  };

  const addRow = () => setReadings(prev => [...prev, {
    _key: `new-${Date.now()}`,
    time: '', aux1Temp: null, aux2Temp: null, aux3Temp: null,
    hclPrimaryTemp: null, hclSecondaryTemp: null,
    pressureA: null, pressureB: null, pressureC: null, pressureD: null,
    hclDensity: null, cpwRfDensity: null, cpwR6Density: null,
    cpwTransferFrom: null, cpwTransferTo: null,
    blowerOn: null, blowerOff: null,
    flowMeterTop: null, flowMeterRa: null, flowMeterR1: null,
  }]);

  const deleteRow = (key: string) => setReadings(prev => prev.filter(r => r._key !== key));

  // ── Save ───────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!date) { toast.error('Date is required.'); return; }
    setStage('saving');

    try {
      const payload = {
        date,
        shift,
        unit_name: unitName,
        operators: operators.split(',').map(s => s.trim()).filter(Boolean),
        helper_name: helper || null,
        readings: readings.map(({ _key, ...r }) => r),
        tank_summaries: tankSummaries,
        remarks: remarks || null,
        notes: { hnpTank: notesHnp || null, hclTank: notesHcl || null },
        uploaded_at: new Date().toISOString(),
        raw_extraction: rawData,
      };

      // Try inserting into unit_log_entries; fallback to audit log if table doesn't exist
      const { error: insertErr } = await insertRows('unit_log_entries', payload);

      if (insertErr) {
        // Table might not exist yet — store in audit log as fallback
        console.warn('[DailyLogPage] unit_log_entries insert failed, falling back to audit log:', insertErr.message);
        await insertRows('batch_edit_logs', {
          batch_no: `daily-log-${date}`,
          action_type: 'daily_log_upload',
          details: payload,
          created_at: new Date().toISOString(),
        });
      }

      setDoneSummary(`${readings.length} hourly readings · ${date} · ${shift}`);
      setStage('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStage('error');
    }
  };

  // ── Reset ──────────────────────────────────────────────────────────────────

  const reset = () => {
    setStage('idle'); setPreviewUrl(null); setError(null);
    setRawData(null); setReadings([]); apiImageRef.current = '';
  };

  // ── Input style ────────────────────────────────────────────────────────────
  const inputCls = 'w-full p-2 border-2 border-slate-200 rounded-xl text-sm focus:border-amber-400 focus:outline-none transition-colors';
  const labelCls = 'block text-xs font-bold text-slate-400 uppercase tracking-wide mb-1';

  // ── Render: done ──────────────────────────────────────────────────────────
  if (stage === 'done') return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 py-16 text-center">
      <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2.5">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>
      <div className="text-lg font-bold text-slate-800">Daily Log Saved!</div>
      <div className="text-sm text-slate-500">{doneSummary}</div>
      <button onClick={reset}
        className="mt-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white"
        style={{ background: '#d97706' }}
      >Upload Another Sheet</button>
    </div>
  );

  // ── Render: error ─────────────────────────────────────────────────────────
  if (stage === 'error') return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 gap-4 max-w-lg mx-auto">
      <div className="w-full bg-red-50 border border-red-200 rounded-xl p-4">
        <div className="text-sm font-bold text-red-700 mb-1">Extraction failed</div>
        <div className="text-xs text-red-600 whitespace-pre-wrap break-words max-h-40 overflow-y-auto leading-relaxed">
          {error}
        </div>
      </div>
      <button onClick={reset} className="px-5 py-2.5 rounded-xl border-2 border-slate-200 text-sm font-bold text-slate-600 hover:bg-slate-50 transition">
        ↩ Try Again
      </button>
    </div>
  );

  // ── Render: loading ───────────────────────────────────────────────────────
  if (stage === 'loading') return (
    <div className="flex-1 flex flex-col items-center justify-center gap-5">
      {previewUrl && (
        <img src={previewUrl} alt="Sheet" className="rounded-xl shadow border border-slate-200 object-cover max-h-52 max-w-xs" style={{ objectPosition: 'top' }} />
      )}
      <svg className="animate-spin" width="32" height="32" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10" stroke="#fde68a" strokeWidth="3" />
        <path d="M12 2 A10 10 0 0 1 22 12" stroke="#d97706" strokeWidth="3" strokeLinecap="round" />
      </svg>
      <div className="text-base font-bold text-slate-700">Reading daily log sheet…</div>
      <div className="text-xs text-slate-400">Llama 3.2 Vision 90B scanning {(readings.length || '~13')} hourly rows</div>
    </div>
  );

  // ── Render: saving ────────────────────────────────────────────────────────
  if (stage === 'saving') return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3">
      <svg className="animate-spin" width="28" height="28" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10" stroke="#fde68a" strokeWidth="3" />
        <path d="M12 2 A10 10 0 0 1 22 12" stroke="#d97706" strokeWidth="3" strokeLinecap="round" />
      </svg>
      <div className="text-sm font-bold text-slate-700">Saving to database…</div>
    </div>
  );

  // ── Render: idle / ready ──────────────────────────────────────────────────
  if (stage === 'idle' || stage === 'ready') return (
    <div className="flex-1 flex flex-col items-center justify-center p-8">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,.jpg,.jpeg,.png,.heic,.webp"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }}
        className="hidden"
      />

      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className="w-full max-w-lg cursor-pointer rounded-2xl border-2 border-dashed transition-all flex flex-col items-center justify-center gap-3 p-8 text-center"
        style={{ borderColor: isDragging ? '#d97706' : '#cbd5e1', background: isDragging ? '#fffbeb' : '#f8fafc' }}
      >
        {previewUrl ? (
          <>
            <img src={previewUrl} alt="preview" className="rounded-xl max-h-52 object-cover shadow" style={{ objectPosition: 'top' }} />
            <div className="text-xs text-slate-400">Tap to change</div>
          </>
        ) : (
          <>
            <div className="w-14 h-14 rounded-2xl bg-amber-50 flex items-center justify-center">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
                <polyline points="10 9 9 9 8 9"/>
              </svg>
            </div>
            <div className="text-base font-bold text-slate-700">Upload Daily Unit Log</div>
            <div className="text-sm text-slate-400">Photo of the hourly monitoring sheet<br/>JPG · PNG · HEIC supported</div>
          </>
        )}
      </div>

      {!previewUrl && (
        <div className="mt-5 max-w-md text-xs text-slate-400 text-center leading-relaxed bg-amber-50 rounded-xl p-4 border border-amber-100">
          <span className="font-bold text-amber-700">What this extracts: </span>
          Hourly readings (Aux-1/2/3 temp, HCL temp, pressures A-D, HCL/CPW density, CPW transfer, blower, flow meters) + tank summaries + remarks.
        </div>
      )}

      {stage === 'ready' && (
        <button
          onClick={handleExtract}
          className="mt-5 px-8 py-3.5 rounded-xl text-white font-bold text-sm flex items-center gap-2 transition-all"
          style={{ background: '#d97706', boxShadow: '0 6px 16px -4px rgba(217,119,6,0.45)' }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
          Extract with AI
        </button>
      )}
    </div>
  );

  // ── Render: review ────────────────────────────────────────────────────────
  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-white rounded-2xl shadow-sm">

      {/* Top bar */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 bg-gradient-to-r from-amber-50 to-slate-50 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-amber-100 flex items-center justify-center">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2.5">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          </div>
          <div>
            <div className="text-sm font-bold text-slate-800">Daily Log — Review & Confirm</div>
            <div className="text-xs text-slate-400">{readings.length} hourly rows detected · Edit any cell before saving</div>
          </div>
        </div>
        <button onClick={reset} className="text-xs font-bold text-slate-400 hover:text-slate-600 px-2 py-1 rounded-lg hover:bg-slate-100 transition">
          ✕ Cancel
        </button>
      </div>

      {/* Body: image left | form right */}
      <div className="flex-1 overflow-hidden flex">

        {/* LEFT: Original image */}
        <div className="shrink-0 border-r border-slate-100 bg-slate-50 overflow-auto flex flex-col items-center p-3 gap-2" style={{ width: 200 }}>
          <div className="text-xs font-bold text-slate-400 uppercase tracking-wide self-start">Original Sheet</div>
          {previewUrl && (
            <img src={previewUrl} alt="original" className="w-full rounded-xl shadow border border-slate-200 object-contain" />
          )}
        </div>

        {/* RIGHT: Extracted data */}
        <div className="flex-1 overflow-auto p-5 space-y-5">

          {/* Header fields */}
          <div>
            <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Sheet Header</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div>
                <label className={labelCls}>Date *</label>
                <input type="text" value={date} onChange={e => setDate(e.target.value)} className={inputCls} placeholder="22/02/26" />
              </div>
              <div>
                <label className={labelCls}>Shift</label>
                <select value={shift} onChange={e => setShift(e.target.value)} className={inputCls}>
                  <option value="">Select</option>
                  <option value="Morning">Morning</option>
                  <option value="Evening">Evening</option>
                  <option value="Night">Night</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Unit Name</label>
                <input type="text" value={unitName} onChange={e => setUnitName(e.target.value)} className={inputCls} placeholder="Unit - II" />
              </div>
              <div className="col-span-2">
                <label className={labelCls}>Operators (comma separated)</label>
                <input type="text" value={operators} onChange={e => setOperators(e.target.value)} className={inputCls} placeholder="Sunny, Rohit, Anjani" />
              </div>
              <div>
                <label className={labelCls}>Helper</label>
                <input type="text" value={helper} onChange={e => setHelper(e.target.value)} className={inputCls} placeholder="Helper name" />
              </div>
            </div>
          </div>

          {/* Truncation warning */}
          {(rawData as { _truncated?: boolean } | null)?._truncated && (
            <div className="flex items-start gap-2 bg-yellow-50 border border-yellow-200 rounded-xl p-3">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2" className="shrink-0 mt-0.5">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
              <div className="text-xs text-yellow-800">
                <span className="font-bold">Partial extraction</span> — the AI response was cut off before finishing all rows.
                The recovered rows are shown below. Please add the missing rows manually using "+ Add Row", or re-upload a smaller/clearer photo.
              </div>
            </div>
          )}

          {/* Hourly readings table */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                Hourly Readings
                <span className="ml-2 px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full font-bold text-xs normal-case">
                  {readings.length} rows
                </span>
              </div>
              <button onClick={addRow} className="text-xs font-bold text-amber-600 hover:text-amber-800 transition flex items-center gap-1">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
                Add Row
              </button>
            </div>

            {readings.length === 0 ? (
              <div className="text-center py-8 text-sm text-slate-400 border-2 border-dashed border-slate-200 rounded-xl">
                No readings extracted. Add rows manually or try a clearer photo.
              </div>
            ) : (
              <div className="rounded-xl border border-slate-200 overflow-auto" style={{ maxHeight: 340 }}>
                <table className="text-xs border-collapse" style={{ minWidth: COLUMN_DEFS.reduce((s, c) => s + c.width + 8, 40) }}>
                  <thead className="bg-slate-50 sticky top-0 z-10">
                    <tr className="border-b border-slate-200">
                      {COLUMN_DEFS.map(c => (
                        <th key={c.key} className="px-1.5 py-2 text-left text-slate-500 font-bold uppercase tracking-wide whitespace-nowrap" style={{ minWidth: c.width }}>
                          {c.label}
                        </th>
                      ))}
                      <th className="px-1.5 py-2 w-7" />
                    </tr>
                  </thead>
                  <tbody>
                    {readings.map((r, idx) => (
                      <tr key={r._key} className="border-b border-slate-100 hover:bg-amber-50/30 transition-colors"
                          style={{ background: idx % 2 === 0 ? undefined : '#fafafa' }}>
                        {COLUMN_DEFS.map(c => (
                          <td key={c.key} className="px-1 py-0.5">
                            <input
                              type={c.type}
                              value={rowVal(r, c.key)}
                              onChange={e => updateCell(r._key, c.key, e.target.value)}
                              className="w-full px-1.5 py-1 border border-transparent rounded-lg text-xs font-mono
                                focus:border-amber-300 focus:bg-white focus:outline-none hover:border-slate-200 transition-colors"
                              style={{ minWidth: c.width - 8 }}
                            />
                          </td>
                        ))}
                        <td className="px-1 py-0.5 text-center">
                          <button onClick={() => deleteRow(r._key)} title="Remove"
                            className="w-5 h-5 flex items-center justify-center rounded text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                            </svg>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Tank summaries */}
          <div>
            <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Tank Summaries</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {tankSummaries.map((t, ti) => (
                <div key={t.tankIndex} className="bg-slate-50 rounded-xl p-3 border border-slate-200 space-y-2">
                  <div className="text-xs font-bold text-slate-600">Tank {t.tankIndex}</div>
                  {[
                    { label: 'Storage Time', val: t.shiftingToStorageTime ?? '', key: 'shiftingToStorageTime' as keyof DailyLogTankSummary },
                    { label: 'Density',       val: t.density != null ? String(t.density) : '', key: 'density' as keyof DailyLogTankSummary },
                    { label: 'Heat Stab. Qty',val: t.heatStabilizerQty ?? '', key: 'heatStabilizerQty' as keyof DailyLogTankSummary },
                    { label: 'Brightener Qty',val: t.brightenerQty ?? '',     key: 'brightenerQty' as keyof DailyLogTankSummary },
                  ].map(({ label, val, key }) => (
                    <div key={key}>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-0.5">{label}</label>
                      <input
                        type={key === 'density' ? 'number' : 'text'}
                        value={val}
                        onChange={e => setTankSummaries(prev => prev.map((ts, i) => i === ti ? {
                          ...ts,
                          [key]: key === 'density'
                            ? (e.target.value === '' ? null : parseFloat(e.target.value))
                            : (e.target.value || null)
                        } : ts))}
                        className="w-full p-1.5 border border-slate-200 rounded-lg text-xs focus:border-amber-300 focus:outline-none"
                        placeholder="—"
                      />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>

          {/* Remarks + notes */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-1">
              <label className={labelCls}>HNP Tank Note</label>
              <input type="text" value={notesHnp} onChange={e => setNotesHnp(e.target.value)} className={inputCls} placeholder="HNP Tank 8-218" />
            </div>
            <div className="sm:col-span-1">
              <label className={labelCls}>HCL Tank Note</label>
              <input type="text" value={notesHcl} onChange={e => setNotesHcl(e.target.value)} className={inputCls} placeholder="HCL Tank-1 - 125" />
            </div>
            <div className="sm:col-span-1">
              <label className={labelCls}>Remarks</label>
              <textarea value={remarks} onChange={e => setRemarks(e.target.value)}
                className={inputCls + ' resize-none'} rows={2} placeholder="Any remarks (Hindi text OK)" />
            </div>
          </div>

        </div>
      </div>

      {/* Footer */}
      <div className="px-5 py-3.5 border-t border-slate-100 bg-slate-50 flex items-center gap-3 shrink-0">
        <button onClick={reset}
          className="py-2.5 px-4 rounded-xl border-2 border-slate-200 text-sm font-bold text-slate-500 hover:bg-slate-100 transition whitespace-nowrap">
          ↩ Re-upload
        </button>
        <div className="flex-1 text-xs text-slate-400 text-center">
          {readings.length} rows · {date || '(no date)'} · {shift || '(no shift)'}
        </div>
        <button onClick={handleSave} disabled={!date}
          className="py-2.5 px-6 rounded-xl text-sm font-bold text-white transition whitespace-nowrap flex items-center gap-2 disabled:opacity-40"
          style={{ background: date ? '#d97706' : '#94a3b8', boxShadow: date ? '0 6px 16px -4px rgba(217,119,6,0.4)' : 'none' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          Save {readings.filter(r => r.time).length} Readings
        </button>
      </div>
    </div>
  );
}
