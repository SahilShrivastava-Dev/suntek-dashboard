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
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { MentionTextarea } from '../../components/mentions';
import { insertRows } from '../../lib/db';
import { useMentionNotifier } from '../../lib/mentions';
import { useBlacklistGuard } from '../../lib/blacklist/guard';
import { useToast } from '../../components/ui/toast';
import { useOcrJobs } from '../../contexts/OcrJobsContext';
import {
  extractDailyLog,
  type ExtractedDailyLog,
  type DailyLogReading,
  type DailyLogTankSummary,
} from '../../lib/nvidiaOcr';

const OCR_CHANNEL = 'daily-log';

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
  const { t } = useTranslation();
  const toast = useToast();
  const notifyMentions = useMentionNotifier();
  const screenBlacklist = useBlacklistGuard();
  // OCR job lives in a provider above the router, so it survives navigating away
  // mid-extraction. This page just reflects + drives that job.
  const ocr = useOcrJobs();
  const job = ocr.getJob<ExtractedDailyLog>(OCR_CHANNEL);
  const previewUrl = job.previewUrl;
  const error = job.error;
  const rawData = job.result;

  const [saving, setSaving]           = useState(false);
  const [savedDone, setSavedDone]     = useState(false);
  const [isDragging, setIsDragging]   = useState(false);
  const [doneSummary, setDoneSummary] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const populatedRef = useRef<ExtractedDailyLog | null>(null);

  // ── Review form state ──────────────────────────────────────────────────────
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
  // Selection + extraction run in the OCR provider so they survive navigation.

  const handleFile = useCallback((file: File) => { ocr.select(OCR_CHANNEL, file, 1200); }, [ocr]);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    const f = e.dataTransfer.files?.[0]; if (f) handleFile(f);
  };

  const handleExtract = () => { ocr.extract(OCR_CHANNEL, extractDailyLog); };

  // When the background OCR finishes, populate the editable review form once.
  // Runs on completion AND when the user returns to the page mid/post extraction.
  useEffect(() => {
    if (job.status !== 'done' || !job.result) return;
    if (populatedRef.current === job.result) return; // already loaded this result
    populatedRef.current = job.result;
    const data = job.result;
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
        const found = (data.tankSummaries ?? []).find(tb => tb.tankIndex === idx);
        return found ?? { tankIndex: idx, shiftingToStorageTime: null, density: null, heatStabilizerQty: null, brightenerQty: null };
      })
    );
  }, [job.status, job.result]);

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
    if (saving) return; // double-submit guard
    if (!date) { toast.error(t('dailyLog.date_required')); return; }
    setSaving(true);

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

      await notifyMentions(remarks, {
        entityLabel: `Daily log · ${unitName || 'Unit'} · ${date}`, route: '/daily-log',
      });

      // Screen OCR/entered operator + helper names against the blacklist.
      const hits = await screenBlacklist(
        [
          ...operators.split(',').map((n) => ({ value: n.trim(), label: 'Operator' })),
          { value: helper, label: 'Helper' },
        ],
        { workflow: 'Daily Log OCR', source: 'ocr', entityLabel: `Daily log · ${unitName || 'Unit'} · ${date}` },
      );
      if (hits.length) {
        const h = hits[0];
        toast.error(t('dailyLog.blacklist_hit', { value: h.candidate.value, type: h.entry.type, name: h.entry.name, pct: Math.round(h.score * 100) }));
      }

      setDoneSummary(t('dailyLog.done_summary', { count: readings.length, date, shift }));
      setSaving(false);
      setSavedDone(true);
    } catch (e) {
      toast.error(t('dailyLog.save_failed', { error: e instanceof Error ? e.message : String(e) }));
      setSaving(false);
    }
  };

  // ── Reset ──────────────────────────────────────────────────────────────────

  const reset = () => {
    setSavedDone(false); setSaving(false);
    setReadings([]); populatedRef.current = null;
    ocr.reset(OCR_CHANNEL);
  };

  // ── Input style ────────────────────────────────────────────────────────────
  const inputCls = 'w-full p-2 border-2 border-slate-200 rounded-xl text-sm focus:border-amber-400 focus:outline-none transition-colors';
  const labelCls = 'block text-xs font-bold text-slate-400 uppercase tracking-wide mb-1';

  // ── Render: done ──────────────────────────────────────────────────────────
  if (savedDone) return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 py-16 text-center">
      <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2.5">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>
      <div className="text-lg font-bold text-slate-800">{t('dailyLog.done_title')}</div>
      <div className="text-sm text-slate-500">{doneSummary}</div>
      <button onClick={reset}
        className="mt-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white"
        style={{ background: '#d97706' }}
      >{t('dailyLog.upload_another')}</button>
    </div>
  );

  // ── Render: error ─────────────────────────────────────────────────────────
  if (job.status === 'error') return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 gap-4 max-w-lg mx-auto">
      <div className="w-full bg-red-50 border border-red-200 rounded-xl p-4">
        <div className="text-sm font-bold text-red-700 mb-1">{t('dailyLog.extraction_failed')}</div>
        <div className="text-xs text-red-600 whitespace-pre-wrap break-words max-h-40 overflow-y-auto leading-relaxed">
          {error}
        </div>
      </div>
      <button onClick={reset} className="px-5 py-2.5 rounded-xl border-2 border-slate-200 text-sm font-bold text-slate-600 hover:bg-slate-50 transition">
        ↩ {t('dailyLog.try_again')}
      </button>
    </div>
  );

  // ── Render: loading (OCR in progress — survives navigation) ───────────────
  if (job.status === 'processing') return (
    <div className="flex-1 flex flex-col items-center justify-center gap-5">
      {previewUrl && (
        <img src={previewUrl} alt="Sheet" className="rounded-xl shadow border border-slate-200 object-cover max-h-52 max-w-xs" style={{ objectPosition: 'top' }} />
      )}
      <svg className="animate-spin" width="32" height="32" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10" stroke="#fde68a" strokeWidth="3" />
        <path d="M12 2 A10 10 0 0 1 22 12" stroke="#d97706" strokeWidth="3" strokeLinecap="round" />
      </svg>
      <div className="text-base font-bold text-slate-700">{t('dailyLog.reading_sheet')}</div>
      <div className="text-xs text-slate-400">{t('dailyLog.scanning_rows', { count: readings.length || '~13' })}</div>
    </div>
  );

  // ── Render: saving ────────────────────────────────────────────────────────
  if (saving) return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3">
      <svg className="animate-spin" width="28" height="28" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10" stroke="#fde68a" strokeWidth="3" />
        <path d="M12 2 A10 10 0 0 1 22 12" stroke="#d97706" strokeWidth="3" strokeLinecap="round" />
      </svg>
      <div className="text-sm font-bold text-slate-700">{t('dailyLog.saving_db')}</div>
    </div>
  );

  // ── Render: idle / ready ──────────────────────────────────────────────────
  if (job.status === 'idle' || job.status === 'ready') return (
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
            <div className="text-xs text-slate-400">{t('dailyLog.tap_to_change')}</div>
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
            <div className="text-base font-bold text-slate-700">{t('dailyLog.upload_title')}</div>
            <div className="text-sm text-slate-400">{t('dailyLog.upload_sub1')}<br/>{t('dailyLog.upload_sub2')}</div>
          </>
        )}
      </div>

      {!previewUrl && (
        <div className="mt-5 max-w-md text-xs text-slate-400 text-center leading-relaxed bg-amber-50 rounded-xl p-4 border border-amber-100">
          <span className="font-bold text-amber-700">{t('dailyLog.what_extracts_label')} </span>
          {t('dailyLog.what_extracts_body')}
        </div>
      )}

      {job.status === 'ready' && (
        <button
          onClick={handleExtract}
          className="mt-5 px-8 py-3.5 rounded-xl text-white font-bold text-sm flex items-center gap-2 transition-all"
          style={{ background: '#d97706', boxShadow: '0 6px 16px -4px rgba(217,119,6,0.45)' }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
          {t('dailyLog.extract_with_ai')}
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
            <div className="text-sm font-bold text-slate-800">{t('dailyLog.review_title')}</div>
            <div className="text-xs text-slate-400">{t('dailyLog.rows_detected', { count: readings.length })}</div>
          </div>
        </div>
        <button onClick={reset} className="text-xs font-bold text-slate-400 hover:text-slate-600 px-2 py-1 rounded-lg hover:bg-slate-100 transition">
          ✕ {t('dailyLog.cancel')}
        </button>
      </div>

      {/* Body: image left | form right */}
      <div className="flex-1 overflow-hidden flex">

        {/* LEFT: Original image */}
        <div className="shrink-0 border-r border-slate-100 bg-slate-50 overflow-auto flex flex-col items-center p-3 gap-2" style={{ width: 200 }}>
          <div className="text-xs font-bold text-slate-400 uppercase tracking-wide self-start">{t('dailyLog.original_sheet')}</div>
          {previewUrl && (
            <img src={previewUrl} alt="original" className="w-full rounded-xl shadow border border-slate-200 object-contain" />
          )}
        </div>

        {/* RIGHT: Extracted data */}
        <div className="flex-1 overflow-auto p-5 space-y-5">

          {/* Header fields */}
          <div>
            <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">{t('dailyLog.sheet_header')}</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div>
                <label className={labelCls}>{t('dailyLog.date_label')}</label>
                <input type="text" value={date} onChange={e => setDate(e.target.value)} className={inputCls} placeholder="22/02/26" />
              </div>
              <div>
                <label className={labelCls}>{t('dailyLog.shift_label')}</label>
                <select value={shift} onChange={e => setShift(e.target.value)} className={inputCls}>
                  <option value="">{t('dailyLog.select_option')}</option>
                  <option value="Morning">{t('dailyLog.morning')}</option>
                  <option value="Evening">{t('dailyLog.evening')}</option>
                  <option value="Night">{t('dailyLog.night')}</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>{t('dailyLog.unit_name_label')}</label>
                <input type="text" value={unitName} onChange={e => setUnitName(e.target.value)} className={inputCls} placeholder="Unit - II" />
              </div>
              <div className="col-span-2">
                <label className={labelCls}>{t('dailyLog.operators_label')}</label>
                <input type="text" value={operators} onChange={e => setOperators(e.target.value)} className={inputCls} placeholder="Sunny, Rohit, Anjani" />
              </div>
              <div>
                <label className={labelCls}>{t('dailyLog.helper_label')}</label>
                <input type="text" value={helper} onChange={e => setHelper(e.target.value)} className={inputCls} placeholder={t('dailyLog.helper_placeholder')} />
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
                <span className="font-bold">{t('dailyLog.partial_extraction')}</span> {t('dailyLog.partial_extraction_body')}
              </div>
            </div>
          )}

          {/* Hourly readings table */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                {t('dailyLog.hourly_readings')}
                <span className="ml-2 px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full font-bold text-xs normal-case">
                  {t('dailyLog.rows_count', { count: readings.length })}
                </span>
              </div>
              <button onClick={addRow} className="text-xs font-bold text-amber-600 hover:text-amber-800 transition flex items-center gap-1">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
                {t('dailyLog.add_row')}
              </button>
            </div>

            {readings.length === 0 ? (
              <div className="text-center py-8 text-sm text-slate-400 border-2 border-dashed border-slate-200 rounded-xl">
                {t('dailyLog.no_readings')}
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
                          <button onClick={() => deleteRow(r._key)} title={t('dailyLog.remove_title')}
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
            <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">{t('dailyLog.tank_summaries')}</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {tankSummaries.map((tank, ti) => (
                <div key={tank.tankIndex} className="bg-slate-50 rounded-xl p-3 border border-slate-200 space-y-2">
                  <div className="text-xs font-bold text-slate-600">{t('dailyLog.tank', { count: tank.tankIndex })}</div>
                  {[
                    { label: t('dailyLog.storage_time'), val: tank.shiftingToStorageTime ?? '', key: 'shiftingToStorageTime' as keyof DailyLogTankSummary },
                    { label: t('dailyLog.density'),       val: tank.density != null ? String(tank.density) : '', key: 'density' as keyof DailyLogTankSummary },
                    { label: t('dailyLog.heat_stab_qty'),val: tank.heatStabilizerQty ?? '', key: 'heatStabilizerQty' as keyof DailyLogTankSummary },
                    { label: t('dailyLog.brightener_qty'),val: tank.brightenerQty ?? '',     key: 'brightenerQty' as keyof DailyLogTankSummary },
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
              <label className={labelCls}>{t('dailyLog.hnp_tank_note')}</label>
              <input type="text" value={notesHnp} onChange={e => setNotesHnp(e.target.value)} className={inputCls} placeholder="HNP Tank 8-218" />
            </div>
            <div className="sm:col-span-1">
              <label className={labelCls}>{t('dailyLog.hcl_tank_note')}</label>
              <input type="text" value={notesHcl} onChange={e => setNotesHcl(e.target.value)} className={inputCls} placeholder="HCL Tank-1 - 125" />
            </div>
            <div className="sm:col-span-1">
              <label className={labelCls}>{t('dailyLog.remarks_label')}</label>
              <MentionTextarea value={remarks} onChange={setRemarks}
                className={inputCls + ' resize-none'} rows={2} placeholder={t('dailyLog.remarks_placeholder')} />
            </div>
          </div>

        </div>
      </div>

      {/* Footer */}
      <div className="px-5 py-3.5 border-t border-slate-100 bg-slate-50 flex items-center gap-3 shrink-0">
        <button onClick={reset}
          className="py-2.5 px-4 rounded-xl border-2 border-slate-200 text-sm font-bold text-slate-500 hover:bg-slate-100 transition whitespace-nowrap">
          ↩ {t('dailyLog.reupload')}
        </button>
        <div className="flex-1 text-xs text-slate-400 text-center">
          {readings.length} {t('dailyLog.rows_word')} · {date || t('dailyLog.no_date')} · {shift || t('dailyLog.no_shift')}
        </div>
        <button onClick={handleSave} disabled={!date}
          className="py-2.5 px-6 rounded-xl text-sm font-bold text-white transition whitespace-nowrap flex items-center gap-2 disabled:opacity-40"
          style={{ background: date ? '#d97706' : '#94a3b8', boxShadow: date ? '0 6px 16px -4px rgba(217,119,6,0.4)' : 'none' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          {t('dailyLog.save_readings', { count: readings.filter(r => r.time).length })}
        </button>
      </div>
    </div>
  );
}
