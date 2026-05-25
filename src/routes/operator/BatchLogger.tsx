import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { ACTIVE_BATCHES } from '../../data/mockData';

interface ReadingRow {
  id: number | string;
  time: string;
  temp: string;
  cpGravity: string;
  cl2Press: string;
  operator: string;
}

const SEED_READINGS: ReadingRow[] = [
  { id: 1, time: '23/02 2:00 PM',   temp: '106 °C', cpGravity: '1140', cl2Press: '1.1 kg',  operator: 'Shyam'    },
  { id: 2, time: '23/02 10:00 AM',  temp: '105 °C', cpGravity: '1070', cl2Press: '1.1 kg',  operator: 'Shyam'    },
  { id: 3, time: '23/02 6:00 AM',   temp: '104 °C', cpGravity: '1010', cl2Press: '1.0 kg',  operator: 'Dev/Kul'  },
  { id: 4, time: '23/02 2:00 AM',   temp: '102 °C', cpGravity: '960',  cl2Press: '900 g',   operator: 'Dev/Kul'  },
  { id: 5, time: '22/02 10:00 PM',  temp: '101 °C', cpGravity: '910',  cl2Press: '800 g',   operator: 'Shyam'    },
];

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
  
  // Mock readings record, loaded from localStorage if exists
  const [mockReadings, setMockReadings] = useState<Record<string, ReadingRow[]>>(() => {
    const saved = localStorage.getItem('suntek_mock_readings');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error("Error loading mock readings from localStorage", e);
      }
    }
    return {
      'mock-batch-1228': SEED_READINGS,
    };
  });

  // Local mock batches created during mock fallback
  const [localMockBatches, setLocalMockBatches] = useState<any[]>(() => {
    const saved = localStorage.getItem('suntek_mock_batches');
    try {
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  });

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

    // 1. Save to local storage list (as fallback and for local timeline view)
    try {
      const savedLogs = localStorage.getItem('suntek_batch_edit_logs');
      const list = savedLogs ? JSON.parse(savedLogs) : [];
      list.unshift({
        id: `mock-log-${Date.now()}`,
        ...logEntry
      });
      localStorage.setItem('suntek_batch_edit_logs', JSON.stringify(list));
    } catch (e) {
      console.error("Failed to write local audit log", e);
    }

    // 2. Save to Supabase
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

  // Tab State
  const [activeTab, setActiveTab] = useState<'reading' | 'new-batch'>('reading');
  const [newBatchNo, setNewBatchNo] = useState('');
  const [newRecipe, setNewRecipe] = useState('1400');
  const [newTargetQty, setNewTargetQty] = useState('1400');
  const [creating, setCreating] = useState(false);

  // Save mock readings and batches to localStorage on any state changes
  useEffect(() => {
    localStorage.setItem('suntek_mock_readings', JSON.stringify(mockReadings));
  }, [mockReadings]);

  useEffect(() => {
    localStorage.setItem('suntek_mock_batches', JSON.stringify(localMockBatches));
  }, [localMockBatches]);

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
      let { data } = await (supabase.from('active_batches') as any).select('*').eq('status', 'active');
      const dbBatches = data || [];
      
      const mockBatches = ACTIVE_BATCHES.map(b => ({
        id: `mock-batch-${b.num}`,
        batch_no: String(b.num),
        recipe: String(b.recipe),
        target_qty: b.target,
        status: 'active'
      }));

      // Combine real database batches, custom created local mock batches, and static mock batches
      const combined = [...dbBatches, ...localMockBatches, ...mockBatches];
      const uniqueBatches: any[] = [];
      const seen = new Set<string>();

      for (const b of combined) {
        const key = String(b.batch_no);
        if (!seen.has(key)) {
          seen.add(key);
          uniqueBatches.push(b);
        }
      }

      setBatches(uniqueBatches);
      if (uniqueBatches.length > 0) {
        setBatchId(uniqueBatches[0].id);
      }
    } catch (err) {
      console.error("Failed to load active batches:", err);
    }
  }

  useEffect(() => {
    loadBatches();
  }, [localMockBatches]);

  // Fetch unique database readings whenever the active batchId changes
  useEffect(() => {
    if (!batchId || batchId.startsWith('mock-')) {
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

    const isMock = batchId.startsWith('mock-');

    if (isMock) {
      // Simulate successful local save in-memory with secure local ISO timestamps
      const now = new Date();
      const timeStr = `${String(now.getDate()).padStart(2,'0')}/${String(now.getMonth()+1).padStart(2,'0')} ${now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;
      const newRow: ReadingRow = {
        id: `mock-reading-${Date.now()}`,
        time: timeStr,
        temp: temp ? `${temp} °C` : '—',
        cpGravity: cpGravity ? String(cpGravity) : '—',
        cl2Press: cl2Press ? `${cl2Press} kg` : '—',
        operator: 'Local Shyam (Mock)',
      };
      
      // Update readings and sync directly to localStorage via state hook
      setMockReadings(prev => ({
        ...prev,
        [batchId]: [newRow, ...(prev[batchId] || [])]
      }));

      // Log the mock reading edit
      writeAuditLog(batchLabel, 'log_reading', { temp, cp_gravity: cpGravity, cl2_pressure: cl2Press });

      // Clear operator session draft cache
      clearSession();

      setTemp(''); setCpGravity(''); setCl2Press('');
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
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

      let createdBatch = newBatch;

      if (error) {
        console.warn("Could not insert active active batch on remote Supabase. Creating locally.", error);
        createdBatch = {
          id: `mock-batch-${Date.now()}`,
          batch_no: newBatchNo,
          recipe: newRecipe,
          target_qty: parseFloat(newTargetQty) || 1400,
          status: 'active'
        };
        setLocalMockBatches(prev => [createdBatch, ...prev]);
      }

      if (createdBatch) {
        // Log the batch creation edit
        writeAuditLog(newBatchNo, 'create_batch', { recipe: newRecipe, target_qty: parseFloat(newTargetQty) || 1400 });

        // Clear operator session draft cache
        clearSession();

        setNewBatchNo('');
        setNewRecipe('1400');
        setNewTargetQty('1400');
        setActiveTab('reading');
        
        alert(`✓ Batch #${createdBatch.batch_no} Started Successfully!`);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setCreating(false);
    }
  }

  // Determine what unique readings are visible for the currently active batch
  const visibleReadings = batchId.startsWith('mock-')
    ? (mockReadings[batchId] || [])
    : readings;

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
            <div className="flex gap-1.5 mb-6 bg-slate-100 p-1.5 rounded-xl border shrink-0">
              <button
                type="button"
                onClick={() => setActiveTab('reading')}
                className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${
                  activeTab === 'reading'
                    ? 'bg-white text-blue-600 shadow-sm border border-slate-200/50'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                Log Reading
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('new-batch')}
                className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${
                  activeTab === 'new-batch'
                    ? 'bg-white text-blue-600 shadow-sm border border-slate-200/50'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                Start New Batch
              </button>
            </div>

            {activeTab === 'reading' ? (
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

        {/* RIGHT: Batch log table */}
        <div className="flex-1 bg-white rounded-2xl flex flex-col overflow-hidden shadow-sm">
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
                      background: i === 0 && !String(r.id).startsWith('mock-reading-') && typeof r.id === 'string' ? '#F0FDF4' : undefined,
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
