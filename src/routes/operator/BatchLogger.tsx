import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { BatchSheetUpload } from '../../components/BatchSheetUpload';
import { BatchSheetReview } from '../../components/BatchSheetReview';
import type { ExtractedBatchSheet } from '../../lib/nvidiaOcr';
import { resizeImageToDataUrl, extractSalesSheet, extractPurchaseSheet } from '../../lib/nvidiaOcr';
import type { ExtractedSalesSheet, ExtractedPurchaseSheet } from '../../lib/nvidiaOcr';

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
  const [batchId, setBatchId] = useState('');
  const [batches, setBatches] = useState<any[]>([]);
  const [temp, setTemp]           = useState('');
  const [cpGravity, setCpGravity] = useState('');
  const [cl2Press, setCl2Press]   = useState('');
  
  // Real database readings list for the active batch
  const [readings, setReadings]   = useState<any[]>([]);

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
        await (supabase.from('operator_sessions') as any).delete().eq('ip_address', ipAddress);
      } catch (e) {
        console.warn("Failed to clear session in database", e);
      }
    }
  }

  // Write Audit Log entry with Timestamp and IP address
  async function writeAuditLog(batchNo: string, actionType: string, details: any) {
    const logEntry = {
      ip_address: ipAddress,
      batch_no: batchNo,
      action_type: actionType,
      details: details,
      created_at: new Date().toISOString()
    };

    try {
      await (supabase.from('batch_edit_logs') as any).insert(logEntry);
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
            if (sess.active_tab) setActiveTab(sess.active_tab);
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
          const { data, error } = await supabase
            .from('operator_sessions')
            .select('*')
            .eq('ip_address', ipAddress)
            .single() as any;

          if (!error && data) {
            const ageMs = Date.now() - new Date(data.last_active).getTime();
            if (ageMs < 1800000) {
              if (data.selected_batch) setBatchId(data.selected_batch);
              if (data.temp_input) setTemp(data.temp_input);
              if (data.cp_gravity_input) setCpGravity(data.cp_gravity_input);
              if (data.cl2_press_input) setCl2Press(data.cl2_press_input);
              if (data.active_tab) setActiveTab(data.active_tab as any);
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

  // Sales / Purchase upload state (simple inline review panels)
  const [salesUpload, setSalesUpload]     = useState<{ stage: 'idle' | 'loading' | 'done' | 'error'; data?: ExtractedSalesSheet; imageUrl?: string; error?: string }>({ stage: 'idle' });
  const [purchaseUpload, setPurchaseUpload] = useState<{ stage: 'idle' | 'loading' | 'done' | 'error'; data?: ExtractedPurchaseSheet; imageUrl?: string; error?: string }>({ stage: 'idle' });

  // Tab State
  const [activeTab, setActiveTab] = useState<'reading' | 'new-batch' | 'upload' | 'upload-sales' | 'upload-purchase'>('reading');
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
          await (supabase.from('operator_sessions') as any).upsert(upsertData);
        } catch (e) {
          console.warn("Failed to auto-save session in database", e);
        }
      }
      saveToDb();
    }
  }, [batchId, temp, cpGravity, cl2Press, activeTab, newBatchNo, newRecipe, newTargetQty, ipAddress]);


  async function loadBatches() {
    try {
      const { data } = await (supabase.from('active_batches') as any).select('*').eq('status', 'active');
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
        const { data, error } = await (supabase
          .from('batch_readings') as any)
          .select('*, profiles(name)')
          .eq('batch_id', batchId)
          .order('timestamp', { ascending: false });
        
        if (!error && data) {
          const formatted = data.map((row: any) => {
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
      alert("No active batch selected");
      return;
    }

    try {
      const { data, error } = await (supabase.from('batch_readings') as any).insert({
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
        (supabase.from('notifications') as any).insert({
          target_roles: ['admin', 'unit_head'],
          title: `Batch reading logged: ${batchLabel}`,
          body: [temp ? `Temp: ${temp}°C` : null, cpGravity ? `CP: ${cpGravity}` : null, cl2Press ? `Cl₂: ${cl2Press} kg` : null].filter(Boolean).join(' · '),
          type: 'info',
          route: '/dashboard/batches',
          actor_name: 'Factory Operator',
          actor_role: 'factory_operator',
          read_by: [],
        }).then(() => {}).catch(() => {});

        // Clear operator session draft cache
        clearSession();

        setTemp(''); setCpGravity(''); setCl2Press('');
        setSaved(true);
        setTimeout(() => setSaved(false), 2500);
      }
    } catch (e: any) {
      console.error(e);
      alert(`Failed to save reading: ${e.message}`);
    }
  }

  async function handleCreateBatch(e: React.FormEvent) {
    e.preventDefault();
    if (!newBatchNo) return;
    setCreating(true);

    try {
      const { data: newBatch, error } = await (supabase.from('active_batches') as any).insert({
        batch_no: newBatchNo,
        recipe: newRecipe,
        target_qty: parseFloat(newTargetQty) || 1400,
        status: 'active'
      }).select().single();

      if (error) {
        alert(`Batch creation failed: ${error.message}\nPlease check your connection and try again.`);
        return;
      }

      if (newBatch) {
        // Log the batch creation edit
        writeAuditLog(newBatchNo, 'create_batch', { recipe: newRecipe, target_qty: parseFloat(newTargetQty) || 1400 });

        // Notify admin of new batch
        (supabase.from('notifications') as any).insert({
          target_roles: ['admin', 'unit_head'],
          title: `New batch started: #${newBatch.batch_no}`,
          body: `Recipe: ${newRecipe} · Target: ${newTargetQty}`,
          type: 'info',
          route: '/dashboard/batches',
          actor_name: 'Factory Operator',
          actor_role: 'factory_operator',
          read_by: [],
        }).then(() => {}).catch(() => {});

        // Clear operator session draft cache
        clearSession();

        setNewBatchNo('');
        setNewRecipe('1400');
        setNewTargetQty('1400');
        setActiveTab('reading');

        alert(`✓ Batch #${newBatch.batch_no} Started Successfully!`);
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

            {/* Segmented Control / Tab Switch */}
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
                onClick={() => setActiveTab('upload-sales')}
                className={`flex-1 py-1.5 text-[11px] font-bold rounded-lg transition-all ${
                  activeTab === 'upload-sales'
                    ? 'bg-white text-green-600 shadow-sm border border-slate-200/50'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                Sales
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('upload-purchase')}
                className={`flex-1 py-1.5 text-[11px] font-bold rounded-lg transition-all ${
                  activeTab === 'upload-purchase'
                    ? 'bg-white text-red-600 shadow-sm border border-slate-200/50'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                Purchase
              </button>
            </div>

            {/* Tab sub-labels for Upload tabs */}
            {(activeTab === 'upload' || activeTab === 'upload-sales' || activeTab === 'upload-purchase') && (
              <div className="flex items-center gap-2 mb-3 px-1">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={activeTab === 'upload-purchase' ? '#dc2626' : activeTab === 'upload-sales' ? '#16a34a' : '#7c3aed'} strokeWidth="2.5">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                <span className="text-xs font-bold" style={{ color: activeTab === 'upload-purchase' ? '#dc2626' : activeTab === 'upload-sales' ? '#16a34a' : '#7c3aed' }}>
                  {activeTab === 'upload' ? 'Add Batch Sheet' : activeTab === 'upload-sales' ? 'Add Sales' : 'Add Purchase'}
                </span>
                {activeTab === 'upload-purchase' && (
                  <span className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-50 text-red-500">
                    locked after upload
                  </span>
                )}
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
            ) : activeTab === 'upload-sales' ? (
              <SalesUploadPanel
                state={salesUpload}
                onFileSelect={async (file) => {
                  const url = URL.createObjectURL(file);
                  setSalesUpload({ stage: 'loading', imageUrl: url });
                  try {
                    const dataUrl = await resizeImageToDataUrl(file);
                    const data = await extractSalesSheet(dataUrl);
                    setSalesUpload({ stage: 'done', data, imageUrl: url });
                  } catch (e: any) {
                    setSalesUpload({ stage: 'error', error: e?.message ?? String(e), imageUrl: url });
                  }
                }}
                onReset={() => setSalesUpload({ stage: 'idle' })}
              />
            ) : activeTab === 'upload-purchase' ? (
              <PurchaseUploadPanel
                state={purchaseUpload}
                onFileSelect={async (file) => {
                  const url = URL.createObjectURL(file);
                  setPurchaseUpload({ stage: 'loading', imageUrl: url });
                  try {
                    const dataUrl = await resizeImageToDataUrl(file);
                    const data = await extractPurchaseSheet(dataUrl);
                    setPurchaseUpload({ stage: 'done', data, imageUrl: url });
                  } catch (e: any) {
                    setPurchaseUpload({ stage: 'error', error: e?.message ?? String(e), imageUrl: url });
                  }
                }}
                onReset={() => setPurchaseUpload({ stage: 'idle' })}
              />
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
                alert(`✓ Batch #${savedBatchNo} sheet saved to database!`);
              }}
              onCancel={() => setUploadReview(null)}
            />
          </div>
        ) : activeTab === 'upload-sales' && salesUpload.stage === 'done' && salesUpload.data ? (
          <div className="flex-1 flex flex-col overflow-hidden">
            <SalesReviewPanel
              data={salesUpload.data}
              imageUrl={salesUpload.imageUrl!}
              onSaved={() => {
                setSalesUpload({ stage: 'idle' });
                alert('✓ Sales sheet saved!');
              }}
              onCancel={() => setSalesUpload({ stage: 'idle' })}
            />
          </div>
        ) : activeTab === 'upload-purchase' && purchaseUpload.stage === 'done' && purchaseUpload.data ? (
          <div className="flex-1 flex flex-col overflow-hidden">
            <PurchaseReviewPanel
              data={purchaseUpload.data}
              imageUrl={purchaseUpload.imageUrl!}
              onClose={() => setPurchaseUpload({ stage: 'idle' })}
            />
          </div>
        ) : null}
        <div className={`flex-1 bg-white rounded-2xl flex flex-col overflow-hidden shadow-sm${
          (activeTab === 'upload' && uploadReview)
          || (activeTab === 'upload-sales' && salesUpload.stage === 'done')
          || (activeTab === 'upload-purchase' && purchaseUpload.stage === 'done')
            ? ' hidden' : ''
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
              onClick={() => alert('Close batch → QC check will run automatically.')}
            >
              Close Batch & Run QC
            </button>
          </div>
        </div>

      </main>
    </div>
  );
}

// ── Inline helper components for Sales / Purchase upload panels ───────────────

function UploadDropzone({ onFile, accentColor, label }: { onFile: (f: File) => void; accentColor: string; label: string }) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = React.useState(false);
  return (
    <div className="flex flex-col gap-3">
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) onFile(f); }}
        className="cursor-pointer rounded-2xl border-2 border-dashed flex flex-col items-center gap-2 py-8 px-4 text-center transition-all"
        style={{ borderColor: dragging ? accentColor : '#cbd5e1', background: dragging ? `${accentColor}10` : '#f8fafc' }}
      >
        <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: `${accentColor}18` }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={accentColor} strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
          </svg>
        </div>
        <div className="text-sm font-bold text-slate-700">{dragging ? 'Drop here' : `Upload ${label}`}</div>
        <div className="text-xs text-slate-400">Tap to select · JPG PNG HEIC</div>
      </div>
    </div>
  );
}

function SalesUploadPanel({ state, onFileSelect, onReset }: {
  state: { stage: 'idle' | 'loading' | 'done' | 'error'; imageUrl?: string; error?: string };
  onFileSelect: (f: File) => void;
  onReset: () => void;
}) {
  if (state.stage === 'loading') {
    return (
      <div className="flex flex-col items-center gap-3 py-6">
        {state.imageUrl && <img src={state.imageUrl} alt="" className="w-full rounded-xl max-h-40 object-cover border border-slate-200" />}
        <svg className="animate-spin" width="28" height="28" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="#e2e8f0" strokeWidth="3" />
          <path d="M12 2 A10 10 0 0 1 22 12" stroke="#16a34a" strokeWidth="3" strokeLinecap="round" />
        </svg>
        <div className="text-sm font-bold text-slate-700">Analyzing sales sheet…</div>
      </div>
    );
  }
  if (state.stage === 'error') {
    return (
      <div className="flex flex-col gap-3">
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-600 break-words">{state.error}</div>
        <button onClick={onReset} className="py-2.5 rounded-xl border-2 border-slate-200 text-sm font-bold text-slate-600">↩ Try Again</button>
      </div>
    );
  }
  if (state.stage === 'done') {
    return (
      <div className="flex flex-col gap-2">
        {state.imageUrl && <img src={state.imageUrl} alt="" className="w-full rounded-xl max-h-32 object-cover border border-green-200" />}
        <div className="bg-green-50 border border-green-200 rounded-xl px-3 py-2.5 flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
          <span className="text-xs font-bold text-green-700">Sales data extracted — review on the right</span>
        </div>
        <button onClick={onReset} className="py-2 rounded-xl border-2 border-slate-200 text-xs font-bold text-slate-500">↩ Upload different sheet</button>
      </div>
    );
  }
  return <UploadDropzone onFile={onFileSelect} accentColor="#16a34a" label="Sales Sheet" />;
}

function PurchaseUploadPanel({ state, onFileSelect, onReset }: {
  state: { stage: 'idle' | 'loading' | 'done' | 'error'; imageUrl?: string; error?: string };
  onFileSelect: (f: File) => void;
  onReset: () => void;
}) {
  if (state.stage === 'loading') {
    return (
      <div className="flex flex-col items-center gap-3 py-6">
        {state.imageUrl && <img src={state.imageUrl} alt="" className="w-full rounded-xl max-h-40 object-cover border border-slate-200" />}
        <svg className="animate-spin" width="28" height="28" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="#e2e8f0" strokeWidth="3" />
          <path d="M12 2 A10 10 0 0 1 22 12" stroke="#dc2626" strokeWidth="3" strokeLinecap="round" />
        </svg>
        <div className="text-sm font-bold text-slate-700">Analyzing purchase sheet…</div>
        <div className="text-xs text-red-500 font-bold">Data will be locked after extraction</div>
      </div>
    );
  }
  if (state.stage === 'error') {
    return (
      <div className="flex flex-col gap-3">
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-600 break-words">{state.error}</div>
        <button onClick={onReset} className="py-2.5 rounded-xl border-2 border-slate-200 text-sm font-bold text-slate-600">↩ Try Again</button>
      </div>
    );
  }
  if (state.stage === 'done') {
    return (
      <div className="flex flex-col gap-2">
        {state.imageUrl && <img src={state.imageUrl} alt="" className="w-full rounded-xl max-h-32 object-cover border border-red-200" />}
        <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2.5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          <span className="text-xs font-bold text-red-700">Purchase data extracted — locked & read-only</span>
        </div>
        <button onClick={onReset} className="py-2 rounded-xl border-2 border-slate-200 text-xs font-bold text-slate-500">↩ Upload different sheet</button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 text-xs text-red-700">
        <span className="font-bold">Purchase Anti-Tampering Rule: </span>
        Data extracted from a Purchase Sheet is strictly locked after upload. No editing is permitted.
      </div>
      <UploadDropzone onFile={onFileSelect} accentColor="#dc2626" label="Purchase Sheet" />
    </div>
  );
}

function SalesReviewPanel({ data, imageUrl, onSaved, onCancel }: { data: ExtractedSalesSheet; imageUrl: string; onSaved: () => void; onCancel: () => void }) {
  const [items, setItems] = React.useState(data.lineItems ?? []);
  const [dcNumber, setDcNumber] = React.useState(data.dcNumber ?? '');
  const [customer, setCustomer] = React.useState(data.customerName ?? '');
  const [date, setDate] = React.useState(data.date ?? '');
  const [vehicle, setVehicle] = React.useState(data.vehicleNumber ?? '');
  const inp = 'w-full p-2 border border-slate-200 rounded-lg text-xs font-medium focus:border-green-400 focus:outline-none bg-white';
  return (
    <div className="flex h-full bg-white rounded-2xl shadow-sm overflow-hidden flex-col">
      <div className="flex items-center justify-between px-5 py-3 border-b bg-green-50 shrink-0">
        <div>
          <div className="text-sm font-bold text-slate-800">Sales Sheet — Review & Confirm</div>
          <div className="text-xs text-slate-400">{items.length} line items · edit before saving</div>
        </div>
        <button onClick={onCancel} className="text-xs font-bold text-slate-400 hover:text-slate-600 px-2 py-1 rounded-lg hover:bg-white">✕ Cancel</button>
      </div>
      <div className="flex flex-1 overflow-hidden">
        <div className="w-48 shrink-0 p-3 border-r bg-slate-50 overflow-auto">
          <div className="text-xs font-bold text-slate-400 mb-2 uppercase">Original</div>
          <img src={imageUrl} alt="" className="w-full rounded-xl border border-slate-200 object-contain" />
        </div>
        <div className="flex-1 overflow-auto p-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {[['DC Number', dcNumber, setDcNumber], ['Date', date, setDate], ['Customer', customer, setCustomer], ['Vehicle No.', vehicle, setVehicle]].map(([label, val, set]) => (
              <div key={label as string}>
                <div className="text-xs font-bold text-slate-400 uppercase mb-1">{label as string}</div>
                <input value={val as string} onChange={e => (set as Function)(e.target.value)} className={inp} />
              </div>
            ))}
          </div>
          <div>
            <div className="text-xs font-bold text-slate-400 uppercase mb-2">Line Items</div>
            <table className="w-full text-xs border-collapse border border-slate-200 rounded-xl overflow-hidden">
              <thead className="bg-slate-50">
                <tr>{['Description', 'Density', 'Qty', 'Rate', 'Amount'].map(h => <th key={h} className="px-2 py-1.5 text-left font-bold text-slate-500 border-b">{h}</th>)}</tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    {(['description', 'density', 'quantity', 'ratePerUnit', 'amount'] as const).map(f => (
                      <td key={f} className="px-1 py-1">
                        <input value={it[f] != null ? String(it[f]) : ''} onChange={e => setItems(prev => prev.map((r, ri) => ri === i ? { ...r, [f]: e.target.value } : r))}
                          className="w-full px-2 py-1 border border-transparent rounded text-xs hover:border-slate-200 focus:border-green-300 focus:outline-none" />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <div className="px-5 py-3 border-t bg-slate-50 flex items-center gap-3 shrink-0">
        <button onClick={onCancel} className="py-2 px-4 rounded-xl border-2 border-slate-200 text-sm font-bold text-slate-500">↩ Re-upload</button>
        <div className="flex-1" />
        <button onClick={onSaved} className="py-2 px-6 rounded-xl text-sm font-bold text-white" style={{ background: '#16a34a' }}>
          Save Sales Sheet to DB
        </button>
      </div>
    </div>
  );
}

function PurchaseReviewPanel({ data, imageUrl, onClose }: { data: ExtractedPurchaseSheet; imageUrl: string; onClose: () => void }) {
  const inp = 'w-full p-2 border border-slate-100 rounded-lg text-xs font-medium bg-slate-50 text-slate-500 cursor-not-allowed';
  return (
    <div className="flex h-full bg-white rounded-2xl shadow-sm overflow-hidden flex-col">
      <div className="flex items-center justify-between px-5 py-3 border-b shrink-0" style={{ background: 'linear-gradient(to right,#fef2f2,#fff7ed)' }}>
        <div>
          <div className="text-sm font-bold text-slate-800">Purchase Sheet — Locked (Read-Only)</div>
          <div className="text-xs text-red-600 font-bold">Purchase data is strictly immutable after upload</div>
        </div>
        <button onClick={onClose} className="text-xs font-bold text-slate-400 hover:text-slate-600 px-2 py-1 rounded-lg hover:bg-white">✕ Close</button>
      </div>
      <div className="flex flex-1 overflow-hidden">
        <div className="w-48 shrink-0 p-3 border-r bg-slate-50 overflow-auto">
          <div className="text-xs font-bold text-slate-400 mb-2 uppercase">Original</div>
          <img src={imageUrl} alt="" className="w-full rounded-xl border border-slate-200 object-contain" />
        </div>
        <div className="flex-1 overflow-auto p-4 space-y-4">
          <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2.5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            <span className="text-xs font-bold text-red-700">All fields are locked — no editing permitted (anti-tampering)</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {[['Invoice No.', data.invoiceNumber], ['Date', data.invoiceDate ?? ''], ['Supplier', data.supplierName ?? ''], ['Buyer', data.buyerName ?? ''], ['Total Amount', data.totalAmount != null ? String(data.totalAmount) : ''], ['Payment Terms', data.paymentTerms ?? '']].map(([label, val]) => (
              <div key={label}>
                <div className="text-xs font-bold text-slate-400 uppercase mb-1">{label}</div>
                <input readOnly value={val ?? ''} className={inp} />
              </div>
            ))}
          </div>
          <div>
            <div className="text-xs font-bold text-slate-400 uppercase mb-2">Line Items <span className="font-normal normal-case text-red-500">(locked)</span></div>
            <table className="w-full text-xs border-collapse border border-slate-200 rounded-xl overflow-hidden">
              <thead className="bg-slate-50">
                <tr>{['Description', 'Qty', 'Rate', 'Amount', 'HSN'].map(h => <th key={h} className="px-2 py-1.5 text-left font-bold text-slate-500 border-b">{h}</th>)}</tr>
              </thead>
              <tbody>
                {(data.lineItems ?? []).map((it, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    {(['description', 'quantity', 'ratePerUnit', 'amount', 'hsnCode'] as const).map(f => (
                      <td key={f} className="px-2 py-1 text-slate-500 cursor-not-allowed">{it[f] != null ? String(it[f]) : '—'}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <div className="px-5 py-3 border-t bg-slate-50 flex items-center gap-3 shrink-0">
        <div className="flex items-center gap-2 text-xs text-red-600 font-bold">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          Saved as immutable record
        </div>
        <div className="flex-1" />
        <button onClick={onClose} className="py-2 px-6 rounded-xl text-sm font-bold text-white bg-slate-700">Done</button>
      </div>
    </div>
  );
}
