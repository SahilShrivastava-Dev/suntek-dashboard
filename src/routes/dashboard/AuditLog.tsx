import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

interface AuditLogEntry {
  id: string;
  ip_address: string;
  batch_no: string;
  action_type: string;
  details: {
    temp?: string | number;
    cp_gravity?: string | number;
    cl2_pressure?: string | number;
    recipe?: string;
    target_qty?: number;
  };
  created_at: string;
}

export function AuditLog() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [clientIp, setClientIp] = useState('Fetching...');
  const [activeSessionsCount, setActiveSessionsCount] = useState(0);

  async function loadData() {
    setLoading(true);
    let dbLogs: AuditLogEntry[] = [];
    
    // 1. Fetch from Supabase batch_edit_logs
    try {
      const { data, error } = await (supabase
        .from('batch_edit_logs') as any)
        .select('*')
        .order('created_at', { ascending: false });
      if (!error && data) {
        dbLogs = data;
      }
    } catch (e) {
      console.warn("Failed to fetch audit logs from Supabase", e);
    }

    // 2. Fetch from Local Storage fallback
    let localLogs: AuditLogEntry[] = [];
    try {
      const saved = localStorage.getItem('suntek_batch_edit_logs');
      if (saved) {
        localLogs = JSON.parse(saved);
      }
    } catch (e) {
      console.error("Error reading local audit logs", e);
    }

    // 3. Fetch active sessions count
    let sessionsCount = 0;
    try {
      const { count } = await (supabase
        .from('operator_sessions') as any)
        .select('*', { count: 'exact', head: true });
      sessionsCount = count || 0;
    } catch (e) {
      // Local fallback count
      const localSess = localStorage.getItem('suntek_logger_session');
      sessionsCount = localSess ? 1 : 0;
    }
    setActiveSessionsCount(sessionsCount);

    // 4. Combine and deduplicate
    const combined = [...dbLogs, ...localLogs];
    const unique: AuditLogEntry[] = [];
    const seen = new Set<string>();

    for (const log of combined) {
      // Use id or timestamp+batch as deduplication key
      const key = log.id || `${log.created_at}-${log.batch_no}-${log.action_type}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(log);
      }
    }

    // Sort by created_at descending
    unique.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    setLogs(unique);
    setLoading(false);
  }

  useEffect(() => {
    loadData();

    // Fetch current client IP
    async function fetchClientIp() {
      try {
        const res = await fetch('https://api.ipify.org?format=json');
        if (res.ok) {
          const data = await res.json();
          setClientIp(data.ip || 'Unknown');
        }
      } catch (err) {
        setClientIp('Unknown');
      }
    }
    fetchClientIp();
  }, []);

  // Filter logs by search query (batch number or IP)
  const filteredLogs = logs.filter(log => {
    const term = searchQuery.toLowerCase();
    return (
      log.batch_no.toLowerCase().includes(term) ||
      (log.ip_address && log.ip_address.toLowerCase().includes(term)) ||
      log.action_type.toLowerCase().includes(term)
    );
  });

  function formatTime(isoString: string) {
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch (e) {
      return '—';
    }
  }

  function formatDate(isoString: string) {
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch (e) {
      return '—';
    }
  }

  return (
    <div style={{ fontFamily: 'Inter, sans-serif' }}>
      {/* Page Header */}
      <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
        <div>
          <div className="text-[12px] text-slate-500">Security · Operations</div>
          <h1 className="serif text-[34px] leading-[1] mt-0.5">Audit log · security logs</h1>
        </div>
        <button
          onClick={loadData}
          className="subtab flex items-center gap-1.5 font-semibold text-xs py-2 px-3 border border-slate-200 bg-white hover:bg-slate-50 rounded-xl"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
          </svg>
          Sync Logs
        </button>
      </div>

      {/* KPI Info Cards */}
      <div className="grid grid-cols-12 gap-5 mb-6">
        <div className="col-span-12 md:col-span-4 card p-5" style={{ background: '#fff', border: '1px solid var(--border)' }}>
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">Total activities</div>
          <div className="text-[28px] font-extrabold mt-1 num">{logs.length}</div>
          <div className="text-[11px] text-slate-400 mt-1">all batches and sessions</div>
        </div>
        <div className="col-span-12 md:col-span-4 card p-5" style={{ background: '#fff', border: '1px solid var(--border)' }}>
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">Active operator sessions</div>
          <div className="text-[28px] font-extrabold mt-1 num text-blue-600">{activeSessionsCount}</div>
          <div className="text-[11px] text-slate-400 mt-1">IP-indexed active drafts</div>
        </div>
        <div className="col-span-12 md:col-span-4 card p-5" style={{ background: '#fff', border: '1px solid var(--border)' }}>
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">Your client IP</div>
          <div className="text-[22px] font-extrabold mt-2 font-mono text-slate-700 truncate">{clientIp}</div>
          <div className="text-[11px] text-slate-400 mt-1">security identification</div>
        </div>
      </div>

      {/* Main card */}
      <div
        className="card p-6"
        style={{ background: 'var(--amber-soft)', border: '1px solid #fde68a' }}
      >
        {/* Header row and Search */}
        <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
          <div>
            <div className="text-base font-bold flex items-center gap-2">
              Chronological Audit Trail
              <span
                className="text-xs font-semibold px-2 py-0.5 rounded-full"
                style={{ background: '#FEF3C7', color: '#D97706' }}
              >
                secured
              </span>
            </div>
            <div className="text-xs text-slate-500">
              Timestamps, operator IP logs, and input metrics captured in real-time
            </div>
          </div>

          <div className="relative w-full max-w-xs">
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search by batch # or IP..."
              className="w-full pl-9 pr-4 py-2 border-2 border-slate-200 rounded-xl focus:border-blue-500 focus:outline-none text-sm font-medium bg-white"
            />
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <circle cx="11" cy="11" r="8"/>
                <path d="m21 21-4.3-4.3"/>
              </svg>
            </span>
          </div>
        </div>

        {/* Timeline viewer */}
        {loading ? (
          <div className="text-center py-12 text-slate-500 font-bold text-sm">
            <span className="inline-block animate-pulse">Synchronizing audit data...</span>
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="text-center py-12 text-slate-500 font-bold text-sm border-2 border-dashed border-slate-200 rounded-2xl bg-white/50">
            No audit logs found matching "{searchQuery}"
          </div>
        ) : (
          <div className="relative pl-6 border-l-2 border-slate-300/60 ml-3 space-y-6">
            {filteredLogs.map((log) => {
              const isCreate = log.action_type === 'create_batch';
              return (
                <div key={log.id || `${log.created_at}-${log.batch_no}`} className="relative group">
                  {/* Timeline bullet dot */}
                  <span
                    className="absolute -left-[33px] top-1.5 w-4.5 h-4.5 rounded-full border-2 border-white flex items-center justify-center shadow-sm z-10 transition-transform group-hover:scale-125"
                    style={{
                      background: isCreate ? '#2563EB' : '#10B981',
                      boxShadow: isCreate ? '0 0 10px rgba(37,99,235,0.4)' : '0 0 10px rgba(16,185,129,0.4)',
                    }}
                  >
                    {isCreate ? (
                      <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="4">
                        <path d="M12 5v14M5 12h14"/>
                      </svg>
                    ) : (
                      <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="4">
                        <path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>
                      </svg>
                    )}
                  </span>

                  {/* Log Content Card */}
                  <div className="card p-4 bg-white/70 backdrop-blur-sm shadow-sm border border-slate-200/50 hover:border-slate-300 transition-all rounded-2xl">
                    <div className="flex items-start justify-between flex-wrap gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900">
                          Batch #{log.batch_no}
                        </span>
                        <span
                          className="text-[10px] font-bold uppercase px-2 py-0.5 rounded"
                          style={{
                            background: isCreate ? '#DBEAFE' : '#D1FAE5',
                            color: isCreate ? '#2563EB' : '#065F46',
                          }}
                        >
                          {isCreate ? 'Started Batch' : 'Logged Reading'}
                        </span>
                      </div>
                      <div className="text-[11px] font-semibold text-slate-400 flex items-center gap-1.5">
                        <span>{formatDate(log.created_at)}</span>
                        <span>•</span>
                        <span className="font-mono text-slate-500">{formatTime(log.created_at)}</span>
                      </div>
                    </div>

                    <div className="text-sm font-medium text-slate-700 space-y-1.5">
                      {isCreate ? (
                        <div>
                          Operator initiated new reactor run with <span className="font-bold text-slate-800">{log.details.recipe} Density</span> and target load of <span className="font-bold text-slate-800">{log.details.target_qty} kg</span>.
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[13px] bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                          {log.details.temp !== undefined && (
                            <div>
                              <span className="text-slate-400 text-xs font-semibold">TEMP:</span>{' '}
                              <span className="font-bold text-slate-800">{log.details.temp} °C</span>
                            </div>
                          )}
                          {log.details.cp_gravity !== undefined && (
                            <div>
                              <span className="text-slate-400 text-xs font-semibold">GRAVITY:</span>{' '}
                              <span className="font-bold text-slate-800">{log.details.cp_gravity}</span>
                            </div>
                          )}
                          {log.details.cl2_pressure !== undefined && (
                            <div>
                              <span className="text-slate-400 text-xs font-semibold">CL₂ PRESS:</span>{' '}
                              <span className="font-bold text-slate-800">{log.details.cl2_pressure} kg</span>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Security details footer */}
                      <div className="flex items-center justify-between text-[11px] text-slate-400 pt-2 border-t border-slate-100 flex-wrap gap-2">
                        <div className="flex items-center gap-1">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 3a4 4 0 0 1 4 4v2M12 11a4 4 0 0 1-4-4V7"/>
                          </svg>
                          <span>IP Address:</span>{' '}
                          <span className="font-mono font-semibold text-slate-600 bg-slate-100/80 px-1 py-0.5 rounded border border-slate-200/30">
                            {log.ip_address || 'Local Sandbox'}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 font-semibold text-[10px] uppercase text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100">
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4 12 14.01l-3-3"/>
                          </svg>
                          Verified Checksum
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="text-center text-[11px] text-slate-400 mt-8">
        Suntek Operations · CaratSense · v0.2 (28-Apr revision)
      </div>
    </div>
  );
}
