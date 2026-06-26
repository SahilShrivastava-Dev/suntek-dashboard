import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { insertRows, upsertRows } from '../../lib/db';
import { useToast } from '../../components/ui/toast';
import type { Database } from '../../lib/database.types';
import { BatchSheetUpload } from '../../components/BatchSheetUpload';
import { BatchSheetReview } from '../../components/BatchSheetReview';
import type { ExtractedBatchSheet } from '../../lib/nvidiaOcr';
// Sales/Purchase OCR upload moved to the Sales & Purchase pages (admin/unit-head/
// accountant only). The Technical Team's batch logger no longer carries them.

type BatchRow = Database['public']['Tables']['active_batches']['Row'];
type ReadingDbRow = Database['public']['Tables']['batch_readings']['Row'] & { profiles?: { name: string | null } | null };
type SessionRow = Database['public']['Tables']['operator_sessions']['Row'];

interface ReadingRow {
  id: number | string;
  time: string;
  temp: string;
  cpGravity: string;
  cl2Press: string;
  operator: string;
}


interface BatchLoggerProps {
  /** When true, hides the standalone header so it can be embedded in the dashboard. */
  embedded?: boolean;
}

export function BatchLogger({ embedded = false }: BatchLoggerProps) {
  const toast = useToast();
  const [batchId, setBatchId] = useState('');
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [temp, setTemp]           = useState('');
  const [cpGravity, setCpGravity] = useState('');
  const [cl2Press, setCl2Press]   = useState('');
  
  // Real database readings list for the active batch
  const [readings, setReadings]   = useState<ReadingRow[]>([]);

  // IP address state
  const [ipAddress, setIpAddress] = useState<string>('Unknown IP');
  
  // Fetch public IP address on mount
  useEffect(() => {
    async function fetchIp() {
      try {
        const res = await fetch('https://api.ipify.org?format=json');
        if (res.ok) {
          const data = await res.json();
          setIpAddress(data.ip || 'Unknown IP');
        }
      } catch (err) {
        console.warn('Failed to fetch public IP address:', err);
      }
    }
    fetchIp();
  }, []);
  

  // Clear Operator Form Session State Cache
  async function clearSession() {
    localStorage.removeItem('suntek_logger_session');
    if (ipAddress && ipAddress !== 'Unknown IP') {
      try {
        await supabase.from('operator_sessions').delete().eq('ip_address', ipAddress);
      } catch (e) {
        console.warn("Failed to clear session in database", e);
      }
    }
  }

  // Write Audit Log entry with Timestamp and IP address
  async function writeAuditLog(batchNo: string, actionType: string, details: Record<string, unknown>) {
    const logEntry = {
      ip_address: ipAddress,
      batch_no: batchNo,
      action_type: actionType,
      details: details,
      created_at: new Date().toISOString()
    };

    try {
      await insertRows('batch_edit_logs', logEntry);
    } catch (e) {
      console.warn("Failed to insert audit log in database", e);
    }
  }

  // Restore session state on load
  useEffect(() => {
    async function restoreSession() {
      let restored = false;

      // 1. Try local storage first
      const localSessionSaved = localStorage.getItem('suntek_logger_session');
      if (localSessionSaved) {
        try {
          const sess = JSON.parse(localSessionSaved);
          const ageMs = Date.now() - (sess.last_active || 0);
          if (ageMs < 1800000) { // 30 minutes inactivity timeout
            if (sess.selected_batch) setBatchId(sess.selected_batch);
            if (sess.temp_input) setTemp(sess.temp_input);
            if (sess.cp_gravity_input) setCpGravity(sess.cp_gravity_input);
            if (sess.cl2_press_input) setCl2Press(sess.cl2_press_input);
            if (sess.active_tab && ['reading','new-batch','upload','history'].includes(sess.active_tab)) setActiveTab(sess.active_tab);
            if (sess.new_batch_no_input) setNewBatchNo(sess.new_batch_no_input);
            if (sess.new_recipe_input) setNewRecipe(sess.new_recipe_input);
            if (sess.new_target_qty_input) setNewTargetQty(sess.new_target_qty_input);
            restored = true;
          } else {
            localStorage.removeItem('suntek_logger_session');
          }
        } catch (e) {
          console.error("Error parsing local session", e);
        }
      }

      // 2. Try Supabase based on IP address
      if (!restored && ipAddress && ipAddress !== 'Unknown IP') {
        try {
          const { data: sessionRows, error } = await supabase
            .from('operator_sessions')
            .select('*')
            .eq('ip_address', ipAddress)
            .limit(1)
            .returns<SessionRow[]>();
          const data = sessionRows?.[0];

          if (!error && data) {
            const ageMs = Date.now() - new Date(data.last_active).getTime();
            if (ageMs < 1800000) {
              if (data.selected_batch) setBatchId(data.selected_batch);
              if (data.temp_input) setTemp(data.temp_input);
              if (data.cp_gravity_input) setCpGravity(data.cp_gravity_input);
              if (data.cl2_press_input) setCl2Press(data.cl2_press_input);
              if (data.active_tab && ['reading','new-batch','upload','history'].includes(data.active_tab)) setActiveTab(data.active_tab as typeof activeTab);
              if (data.new_batch_no_input) setNewBatchNo(data.new_batch_no_input);
              if (data.new_recipe_input) setNewRecipe(data.new_recipe_input);
              if (data.new_target_qty_input) setNewTargetQty(data.new_target_qty_input);
            }
          }
        } catch (e) {
          console.warn("Failed to restore session from Supabase", e);
        }
      }
    }
    
    if (ipAddress) {
      restoreSession();
    }
  }, [ipAddress]);


  const [saved, setSaved]         = useState(false);

  // Upload-review state: when set, right panel shows extracted data side-by-side
  const [uploadReview, setUploadReview] = useState<{
    data: ExtractedBatchSheet;
    imageUrl: string;
  } | null>(null);

  // Tab State — driven by the sidebar (?tab=) when embedded in the dashboard.
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<'reading' | 'new-batch' | 'upload' | 'history'>('reading');
  // When embedded, the 3 sidebar dropdowns select the active panel via ?tab=.
  useEffect(() => {
    if (!embedded) return;
    const t = searchParams.get('tab');
    if (t && ['reading', 'new-batch', 'upload', 'history'].includes(t)) {
      setActiveTab(t as 'reading' | 'new-batch' | 'upload' | 'history');
    }
  }, [searchParams, embedded]);
  const [newBatchNo, setNewBatchNo] = useState('');
  const [newRecipe, setNewRecipe] = useState('1400');
  const [newTargetQty, setNewTargetQty] = useState('1400');
  const [creating, setCreating] = useState(false);

  // Auto-save form inputs to localStorage and Supabase on change
  useEffect(() => {
    // Avoid auto-saving when everything is completely empty (e.g. initial loads or after form resets)
    const isClean = !batchId && !temp && !cpGravity && !cl2Press && !newBatchNo;
    if (isClean) return;

    const sessionData = {
      selected_batch: batchId,
      temp_input: temp,
      cp_gravity_input: cpGravity,
      cl2_press_input: cl2Press,
      active_tab: activeTab,
      new_batch_no_input: newBatchNo,
      new_recipe_input: newRecipe,
      new_target_qty_input: newTargetQty,
      last_active: Date.now()
    };

    localStorage.setItem('suntek_logger_session', JSON.stringify(sessionData));

    if (ipAddress && ipAddress !== 'Unknown IP') {
      const upsertData = {
        ip_address: ipAddress,
        selected_batch: batchId || null,
        temp_input: temp || null,
        cp_gravity_input: cpGravity || null,
        cl2_press_input: cl2Press || null,
        active_tab: activeTab || null,
        new_batch_no_input: newBatchNo || null,
        new_recipe_input: newRecipe || null,
        new_target_qty_input: newTargetQty || null,
        last_active: new Date().toISOString()
      };

      async function saveToDb() {
        try {
          await upsertRows('operator_sessions', upsertData);
        } catch (e) {
          console.warn("Failed to auto-save session in database", e);
        }
      }
      saveToDb();
    }
  }, [batchId, temp, cpGravity, cl2Press, activeTab, newBatchNo, newRecipe, newTargetQty, ipAddress]);


  async function loadBatches() {
    try {
      const { data } = await supabase.from('active_batches').select('*').eq('status', 'active').returns<BatchRow[]>();
      const dbBatches = data || [];
      setBatches(dbBatches);
      if (dbBatches.length > 0) {
        setBatchId(dbBatches[0].id);
      }
    } catch (err) {
      console.error("Failed to load active batches:", err);
    }
  }

  useEffect(() => {
    loadBatches();
  }, []);

  // Fetch readings whenever the active batchId changes
  useEffect(() => {
    if (!batchId) {
      setReadings([]);
      return;
    }

    async function fetchReadings() {
      try {
        const { data, error } = await supabase
          .from('batch_readings')
          .select('*, profiles(name)')
          .eq('batch_id', batchId)
          .order('timestamp', { ascending: false })
          .returns<ReadingDbRow[]>();

        if (!error && data) {
          const formatted = data.map((row) => {
            const now = new Date(row.timestamp);
            const timeStr = `${String(now.getDate()).padStart(2,'0')}/${String(now.getMonth()+1).padStart(2,'0')} ${now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;
            return {
              id: row.id,
              time: timeStr,
              temp: row.temp ? `${row.temp} °C` : '—',
              cpGravity: row.cp_gravity ? String(row.cp_gravity) : '—',
              cl2Press: row.cl2_pressure ? `${row.cl2_pressure} kg` : '—',
              operator: row.profiles?.name || 'Live Op',
            };
          });
          setReadings(formatted);
        }
      } catch (err) {
        console.error("Error fetching readings:", err);
      }
    }
    fetchReadings();
  }, [batchId]);

  const selectedBatch = batches.find(b => b.id === batchId);
  const batchLabel = selectedBatch?.batch_no ?? '';

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!temp && !cpGravity && !cl2Press) return;
    if (!batchId) {
      toast.error('No active batch selected');
      return;
    }

    try {
      const { data, error } = await insertRows('batch_readings', {
        batch_id: batchId,
        temp: temp ? parseFloat(temp) : null,
        cp_gravity: cpGravity ? parseFloat(cpGravity) : null,
        cl2_pressure: cl2Press ? parseFloat(cl2Press) : null,
      }).select('*, profiles(name)').single();

      if (error) throw error;

      if (data) {
        const now = new Date(data.timestamp);
        const timeStr = `${String(now.getDate()).padStart(2,'0')}/${String(now.getMonth()+1).padStart(2,'0')} ${now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;
        const newRow: ReadingRow = {
          id: data.id,
          time: timeStr,
          temp: data.temp ? `${data.temp} °C` : '—',
          cpGravity: data.cp_gravity ? String(data.cp_gravity) : '—',
          cl2Press: data.cl2_pressure ? `${data.cl2_pressure} kg` : '—',
          operator: data.profiles?.name || 'Live Op',
        };
        setReadings(prev => [newRow, ...prev]);

        // Log the real reading edit
        writeAuditLog(batchLabel, 'log_reading', { temp, cp_gravity: cpGravity, cl2_pressure: cl2Press });

        // Notify admin that a reading was logged
        insertRows('notifications', {
          target_roles: ['admin', 'unit_head'],
          title: `Batch reading logged: ${batchLabel}`,
          body: [temp ? `Temp: ${temp}°C` : null, cpGravity ? `CP: ${cpGravity}` : null, cl2Press ? `Cl₂: ${cl2Press} kg` : null].filter(Boolean).join(' · '),
          type: 'info',
          route: '/dashboard/batches',
          actor_name: 'Factory Operator',
          actor_role: 'factory_operator',
          read_by: [],
        }).then(() => {}, () => {});

        // Clear operator session draft cache
        clearSession();

        setTemp(''); setCpGravity(''); setCl2Press('');
        setSaved(true);
        setTimeout(() => setSaved(false), 2500);
      }
    } catch (e) {
      console.error(e);
      toast.error(`Failed to save reading: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function handleCreateBatch(e: React.FormEvent) {
    e.preventDefault();
    if (!newBatchNo) return;
    setCreating(true);

    try {
      const { data: newBatch, error } = await insertRows('active_batches', {
        batch_no: newBatchNo,
        recipe: newRecipe,
        target_qty: parseFloat(newTargetQty) || 1400,
        status: 'active'
      }).select().single();

      if (error) {
        toast.error(`Batch creation failed: ${error.message}. Please check your connection and try again.`);
        return;
      }

      if (newBatch) {
        // Log the batch creation edit
        writeAuditLog(newBatchNo, 'create_batch', { recipe: newRecipe, target_qty: parseFloat(newTargetQty) || 1400 });

        // Notify admin of new batch
        insertRows('notifications', {
          target_roles: ['admin', 'unit_head'],
          title: `New batch started: #${newBatch.batch_no}`,
          body: `Recipe: ${newRecipe} · Target: ${newTargetQty}`,
          type: 'info',
          route: '/dashboard/batches',
          actor_name: 'Factory Operator',
          actor_role: 'factory_operator',
          read_by: [],
        }).then(() => {}, () => {});

        // Clear operator session draft cache
        clearSession();

        setNewBatchNo('');
        setNewRecipe('1400');
        setNewTargetQty('1400');
        setActiveTab('reading');

        toast.success(`Batch #${newBatch.batch_no} started successfully!`);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setCreating(false);
    }
  }

  const visibleReadings = readings;

  // Elapsed time from a hardcoded start (just display)
  const elapsed = '16h 45m';

  return (
    <div
      className={embedded ? 'flex flex-col' : 'h-screen flex flex-col'}
      style={{ background: embedded ? 'transparent' : '#E2E8F0', fontFamily: 'Inter, sans-serif' }}
    >
      {/* Standalone-only header — hidden when embedded in the dashboard */}
      {!embedded && (
        <header className="bg-slate-900 text-white p-4 flex items-center justify-between shadow-md shrink-0">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center font-bold text-xl">S</div>
            <div>
              <div className="text-xs font-bold text-blue-300 uppercase tracking-wider">Factory Console (L1)</div>
              <div className="text-lg font-bold">Batch Logger</div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="text-sm font-bold">Operator: Shyam</div>
              <div className="text-xs text-slate-400">Shift: 6 AM – 2 PM</div>
            </div>
          </div>
        </header>
      )}

      {/* Two-column body */}
      <main className={embedded ? 'flex-1 flex gap-6' : 'flex-1 overflow-hidden p-6 flex gap-6'}>

        {/* LEFT: Tab switches and Forms */}
        <div className="w-80 shrink-0 flex flex-col gap-0">
          <div className="bg-white rounded-2xl p-6 flex-1 overflow-auto shadow-sm flex flex-col">
            <h2 className="text-xl font-bold mb-4 flex items-center gap-2 border-b pb-2">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2.5">
                <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
              </svg>
              Batch Actions
            </h2>

            {/* Segmented control — standalone app only. In the dashboard the 3
                sidebar dropdowns (Batch / Operations / Logs) drive navigation. */}
            {!embedded && (
            <div className="flex gap-1 mb-4 bg-slate-100 p-1 rounded-xl border shrink-0">
              <button
                type="button"
                onClick={() => setActiveTab('reading')}
                className={`flex-1 py-1.5 text-[11px] font-bold rounded-lg transition-all ${
                  activeTab === 'reading'
                    ? 'bg-white text-blue-600 shadow-sm border border-slate-200/50'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                Log
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('new-batch')}
                className={`flex-1 py-1.5 text-[11px] font-bold rounded-lg transition-all ${
                  activeTab === 'new-batch'
                    ? 'bg-white text-blue-600 shadow-sm border border-slate-200/50'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                New Batch
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('upload')}
                className={`flex-1 py-1.5 text-[11px] font-bold rounded-lg transition-all ${
                  activeTab === 'upload'
                    ? 'bg-white text-violet-600 shadow-sm border border-slate-200/50'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                Batch
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('history')}
                className={`flex-1 py-1.5 text-[11px] font-bold rounded-lg transition-all ${
                  activeTab === 'history'
                    ? 'bg-white text-blue-600 shadow-sm border border-slate-200/50'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                History
              </button>
            </div>
            )}

            {/* Tab sub-label for the Batch Sheet upload tab */}
            {activeTab === 'upload' && (
              <div className="flex items-center gap-2 mb-3 px-1">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="2.5">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                <span className="text-xs font-bold" style={{ color: '#7c3aed' }}>
                  Add Batch Sheet
                </span>
              </div>
            )}

            {activeTab === 'upload' ? (
              <BatchSheetUpload
                reviewing={!!uploadReview}
                onExtracted={(data, previewUrl) => setUploadReview({ data, imageUrl: previewUrl })}
                onReset={() => setUploadReview(null)}
                docLabel="Batch Sheet"
                accentColor="#7c3aed"
              />
            ) : activeTab === 'history' ? (
              <div className="flex-1 flex flex-col gap-4">
                {/* Batch selector — choose which batch's reading history to view */}
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-2 uppercase tracking-wide">
                    Select Batch
                  </label>
                  <select
                    value={batchId}
                    onChange={e => setBatchId(e.target.value)}
                    className="w-full p-3 border-2 border-slate-200 rounded-xl font-bold text-base bg-slate-50 focus:border-blue-500 focus:outline-none"
                  >
                    {batches.map(b => (
                      <option key={b.id} value={b.id}>
                        BATCH #{b.batch_no} ({b.recipe ? `${b.recipe} Density` : 'Generic'})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="rounded-xl bg-blue-50 border border-blue-100 p-4 text-sm text-slate-600 leading-relaxed">
                  Read-only view. The full reading log for the selected batch is shown
                  on the right. To add a new reading, use <span className="font-semibold text-blue-700">Log Reading</span>.
                </div>
              </div>
            ) : activeTab === 'reading' ? (
              <form onSubmit={handleSave} className="space-y-5 flex-1 flex flex-col justify-between">
                <div className="space-y-4">
                  {/* Batch selector */}
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-2 uppercase tracking-wide">
                      Select Active Batch
                    </label>
                    <select
                      value={batchId}
                      onChange={e => setBatchId(e.target.value)}
                      className="w-full p-3 border-2 border-slate-200 rounded-xl font-bold text-base bg-slate-50 focus:border-blue-500 focus:outline-none"
                    >
                      {batches.map(b => (
                        <option key={b.id} value={b.id}>
                          BATCH #{b.batch_no} ({b.recipe ? `${b.recipe} Density` : 'Generic'})
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Temperature */}
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-2 uppercase tracking-wide">
                      Temperature (°C)
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        value={temp}
                        onChange={e => setTemp(e.target.value)}
                        placeholder="105"
                        className="w-full text-2xl text-center font-bold font-mono p-4 border-2 border-slate-200 rounded-xl focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 transition"
                      />
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">°C</span>
                    </div>
                  </div>

                  {/* CP Gravity */}
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-2 uppercase tracking-wide">
                      CP Gravity
                    </label>
                    <input
                      type="number"
                      value={cpGravity}
                      onChange={e => setCpGravity(e.target.value)}
                      placeholder="1140"
                      className="w-full text-2xl text-center font-bold font-mono p-4 border-2 border-slate-200 rounded-xl focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 transition"
                    />
                  </div>

                  {/* Cl2 Pressure */}
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-2 uppercase tracking-wide">
                      Cl₂ Pressure
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        step="0.1"
                        value={cl2Press}
                        onChange={e => setCl2Press(e.target.value)}
                        placeholder="1.1"
                        className="w-full text-2xl text-center font-bold font-mono p-4 border-2 border-slate-200 rounded-xl focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 transition"
                      />
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">kg</span>
                    </div>
                  </div>
                </div>

                <button
                  type="submit"
                  className="w-full text-white font-bold py-4 rounded-xl text-lg shadow-lg transition-all mt-4"
                  style={{ background: saved ? '#10B981' : '#2563EB', boxShadow: '0 8px 20px -4px rgba(37,99,235,0.35)' }}
                >
                  {saved ? '✓ Reading Saved!' : 'Save Reading'}
                </button>
              </form>
            ) : (
              <form onSubmit={handleCreateBatch} className="space-y-5 flex-1 flex flex-col justify-between">
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-2 uppercase tracking-wide">
                      New Batch Number *
                    </label>
                    <input
                      type="text"
                      required
                      value={newBatchNo}
                      onChange={e => setNewBatchNo(e.target.value)}
                      placeholder="e.g. 1236"
                      className="w-full p-3.5 border-2 border-slate-200 rounded-xl font-bold text-base bg-slate-50 focus:border-blue-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-2 uppercase tracking-wide">
                      Recipe / Density *
                    </label>
                    <select
                      value={newRecipe}
                      onChange={e => setNewRecipe(e.target.value)}
                      className="w-full p-3.5 border-2 border-slate-200 rounded-xl font-bold text-base bg-slate-50 focus:border-blue-500 focus:outline-none"
                    >
                      <option value="1300">1300 Density</option>
                      <option value="1400">1400 Density</option>
                      <option value="1450">1450 Density</option>
                      <option value="1500">1500 Density</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-2 uppercase tracking-wide">
                      Target Quantity (kg) *
                    </label>
                    <input
                      type="number"
                      required
                      value={newTargetQty}
                      onChange={e => setNewTargetQty(e.target.value)}
                      placeholder="1400"
                      className="w-full p-3.5 border-2 border-slate-200 rounded-xl font-bold text-base bg-slate-50 focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={creating}
                  className="w-full text-white font-bold py-4 rounded-xl text-lg shadow-lg transition-all bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 mt-6"
                  style={{ boxShadow: '0 8px 20px -4px rgba(37,99,235,0.35)' }}
                >
                  {creating ? 'Starting Batch...' : 'Start New Batch'}
                </button>
              </form>
            )}
          </div>
        </div>

        {/* RIGHT: Batch log table — or OCR review panels when upload is active */}
        {activeTab === 'upload' && uploadReview ? (
          <div className="flex-1 flex flex-col overflow-hidden">
            <BatchSheetReview
              data={uploadReview.data}
              imageUrl={uploadReview.imageUrl}
              batches={batches}
              ipAddress={ipAddress}
              onSaved={(savedBatchNo) => {
                setUploadReview(null);
                loadBatches();
                setActiveTab('reading');
                toast.success(`Batch #${savedBatchNo} sheet saved to database!`);
              }}
              onCancel={() => setUploadReview(null)}
            />
          </div>
        ) : null}
        <div className={`flex-1 bg-white rounded-2xl flex flex-col overflow-hidden shadow-sm${
          (activeTab === 'upload' && uploadReview) ? ' hidden' : ''
        }`}>
          {/* Table header bar */}
          <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50 rounded-t-2xl shrink-0">
            <div>
              <h3 className="font-bold text-lg">Batch {batchLabel ? `#${batchLabel}` : 'Log'} Log</h3>
              <div className="text-xs text-slate-500">Started: 22/02/26 10 PM</div>
            </div>
            <div
              className="font-bold px-3 py-1 rounded-full text-sm"
              style={{ background: '#D1FAE5', color: '#065F46' }}
            >
              Running ({elapsed})
            </div>
          </div>

          {/* Scrollable table */}
          <div className="flex-1 overflow-auto">
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-100 sticky top-0 text-xs uppercase text-slate-500 font-bold">
                <tr>
                  <th className="p-4 border-b">Time</th>
                  <th className="p-4 border-b">Temp</th>
                  <th className="p-4 border-b">CP Gravity</th>
                  <th className="p-4 border-b">Cl₂ Press.</th>
                  <th className="p-4 border-b">Operator</th>
                </tr>
              </thead>
              <tbody className="text-sm font-medium">
                {visibleReadings.map((r, i) => (
                  <tr
                    key={r.id}
                    className="border-b transition-colors"
                    style={{
                      background: i === 0 ? '#F0FDF4' : undefined,
                    }}
                  >
                    <td className="p-4 font-mono text-xs text-slate-500">{r.time}</td>
                    <td className="p-4 font-mono">{r.temp}</td>
                    <td className="p-4 font-mono">{r.cpGravity}</td>
                    <td className="p-4 font-mono">{r.cl2Press}</td>
                    <td className="p-4 text-slate-500">{r.operator}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Close batch footer */}
          <div className="p-4 border-t border-slate-100 flex items-center justify-between shrink-0 bg-slate-50">
            <div className="text-xs text-slate-500">
              {visibleReadings.length} reading{visibleReadings.length !== 1 ? 's' : ''} logged this batch
            </div>
            <button
              className="text-xs font-bold px-4 py-2 rounded-xl border transition-colors hover:bg-red-50"
              style={{ borderColor: '#FCA5A5', color: '#DC2626' }}
              onClick={() => toast.info('Close batch → QC check will run automatically.')}
            >
              Close Batch & Run QC
            </button>
          </div>
        </div>

      </main>
    </div>
  );
}
