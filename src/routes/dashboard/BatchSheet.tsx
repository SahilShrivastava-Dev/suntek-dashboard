import React, { useEffect, useState } from 'react';
import { ACTIVE_BATCHES } from '../../data/mockData';
import { supabase } from '../../lib/supabase';
import { Link } from 'react-router-dom';

const QC_BADGE: Record<string, { bg: string; color: string }> = {
  pending:  { bg: '#FEF3C7', color: '#D97706' },
  awaiting: { bg: '#F1F5F9', color: '#475569' },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatBatch(b: any) {
  const readingsCount = b.batch_readings ? b.batch_readings.length : 0;
  // Dynamic calculation based on actual logged readings
  const computedCurrent = readingsCount * 10;
  const computedDrums = readingsCount;

  return {
    id: b.id,
    num: b.batch_no,
    plant: b.plants?.name || 'Live Plant',
    recipe: b.recipe || 'N/A',
    target: b.target_qty || 1000,
    current: computedCurrent,
    drums: computedDrums,
    elapsed: 'Live',
    op: b.profiles?.name || 'Operator',
    qc: 'pending',
    editCount: readingsCount
  };
}

export function BatchSheet() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [liveBatches, setLiveBatches] = useState<any[]>([]);
  const [updateFlash, setUpdateFlash] = useState<string | null>(null);

  const [localMockBatches, setLocalMockBatches] = useState<any[]>([]);
  const [mockReadings, setMockReadings] = useState<Record<string, any>>({});

  useEffect(() => {
    // Load local mock batches
    const savedBatches = localStorage.getItem('suntek_mock_batches');
    if (savedBatches) {
      try {
        setLocalMockBatches(JSON.parse(savedBatches));
      } catch (e) {
        console.error("Error loading local mock batches", e);
      }
    }

    // Load mock readings
    const savedReadings = localStorage.getItem('suntek_mock_readings');
    if (savedReadings) {
      try {
        setMockReadings(JSON.parse(savedReadings));
      } catch (e) {
        console.error("Error loading mock readings", e);
      }
    }
  }, []);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('active_batches')
        .select('*, profiles(name), plants(name), batch_readings(id)')
        .eq('status', 'active') as any;
      if (data) {
        setLiveBatches(data.map(formatBatch));
      }
    }
    load();

    // Subscribe to new readings to update the "current" qty and edit count in real-time
    const readingsSub = supabase.channel('batch_readings_changes')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'batch_readings' }, (payload) => {
        const bId = payload.new.batch_id;
        setUpdateFlash(bId);
        setLiveBatches(prev => prev.map(b => {
          if (b.id === bId) {
            return { 
              ...b, 
              current: b.current + 10, 
              drums: b.drums + 1,
              editCount: b.editCount + 1
            };
          }
          return b;
        }));
        setTimeout(() => setUpdateFlash(null), 2000);
      })
      .subscribe();

    // Subscribe to new active batch creation in real-time
    const batchesSub = supabase.channel('active_batches_dashboard_changes')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'active_batches' }, async (payload) => {
        const { data } = await supabase
          .from('active_batches')
          .select('*, profiles(name), plants(name), batch_readings(id)')
          .eq('id', payload.new.id)
          .single() as any;
        
        if (data) {
          const formatted = formatBatch(data);
          setLiveBatches(prev => {
            if (prev.some(b => b.id === formatted.id)) return prev;
            return [formatted, ...prev];
          });
          setUpdateFlash(formatted.id);
          setTimeout(() => setUpdateFlash(null), 3000);
        } else {
          const formatted = formatBatch(payload.new);
          setLiveBatches(prev => {
            if (prev.some(b => b.id === formatted.id)) return prev;
            return [formatted, ...prev];
          });
          setUpdateFlash(formatted.id);
          setTimeout(() => setUpdateFlash(null), 3000);
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(readingsSub);
      supabase.removeChannel(batchesSub);
    };
  }, []);

  const formattedLocalMockBatches = localMockBatches.map(b => ({
    id: b.id,
    num: Number(b.batch_no) || b.batch_no,
    plant: 'Live Plant',
    recipe: b.recipe || 'N/A',
    target: b.target_qty || 1000,
    current: 0,
    drums: 0,
    elapsed: 'Live',
    op: 'Operator',
    qc: 'pending',
    editCount: 0
  }));

  // Merge and deduplicate by unique batch number (num), prioritizing live database entries
  const combined = [...liveBatches, ...formattedLocalMockBatches, ...ACTIVE_BATCHES];
  const uniqueBatches: any[] = [];
  const seenNumbers = new Set<string>();

  for (const b of combined) {
    const key = String(b.num);
    if (!seenNumbers.has(key)) {
      seenNumbers.add(key);

      // Check if it's a mock batch (meaning it's from ACTIVE_BATCHES or formattedLocalMockBatches, i.e., id starts with mock- or is not from liveBatches)
      const isMock = !liveBatches.some(live => String(live.num) === key);
      let updatedBatch = { ...b, editCount: b.editCount || 0 };

      if (isMock) {
        const mockKey = `mock-batch-${key}`;
        const readingsList = mockReadings[mockKey] || [];
        const initialSeedCount = String(key) === '1228' ? 5 : 0;
        const newEdits = Math.max(0, readingsList.length - initialSeedCount);

        if (newEdits > 0) {
          updatedBatch.current = (b.current || 0) + newEdits * 10;
          updatedBatch.drums = (b.drums || 0) + newEdits;
          updatedBatch.editCount = 1 + newEdits;
        }
      }

      uniqueBatches.push(updatedBatch);
    }
  }

  const combinedBatches = uniqueBatches;

  return (
    <>
      {/* KPIs */}
      <div className="grid grid-cols-12 gap-5 mb-5">
        <div className="col-span-12 lg:col-span-3 card p-5">
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">Active batches</div>
          <div className="text-[28px] font-extrabold mt-1 num">7</div>
          <div className="text-[11px] text-slate-500 mt-1">across 4 factories</div>
        </div>
        <div className="col-span-12 lg:col-span-3 card p-5">
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">Closed today</div>
          <div className="text-[28px] font-extrabold mt-1 num">3</div>
          <div className="text-[11px] text-slate-500 mt-1">96 drums total</div>
        </div>
        <div className="col-span-12 lg:col-span-3 card p-5">
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">Avg yield vs ratio</div>
          <div className="text-[28px] font-extrabold mt-1 num">+0.4%</div>
        </div>
        <div className="col-span-12 lg:col-span-3 card p-5">
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">Variance flagged</div>
          <div className="text-[28px] font-extrabold mt-1 num text-amber-600">1</div>
          <div className="text-[11px] text-amber-600 mt-1">Batch 1228 +2.4%</div>
        </div>
      </div>

      {/* Active batches table — amber-soft */}
      <div className="card p-6" style={{ background: 'var(--amber-soft)', border: '1px solid #fde68a' }}>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
          <div>
            <div className="text-base font-bold">Active batches</div>
            <div className="text-xs text-slate-500">Live readings · oil-ratio variance computed on close</div>
          </div>
          <Link 
            to="/operator/batch-logger" 
            className="btn-accent pill px-4 py-2 font-semibold text-sm no-underline inline-block text-center flex items-center justify-center"
          >
            + Start batch
          </Link>
        </div>
        <div className="overflow-x-auto scroll-x">
          <table className="dt">
            <thead>
              <tr>
                <th>Batch #</th><th>Plant</th><th>Recipe</th>
                <th className="num">Target</th><th className="num">Current</th>
                <th className="num">Drums</th><th className="num">Elapsed</th>
                <th>Operator</th><th>QC</th>
              </tr>
            </thead>
            <tbody>
              {combinedBatches.map(b => {
                const qc = QC_BADGE[b.qc] || QC_BADGE.awaiting;
                const isFlashing = updateFlash === b.id;
                return (
                  <tr key={b.num} style={{ 
                    cursor: 'pointer',
                    transition: 'background-color 0.5s',
                    backgroundColor: isFlashing ? '#D1FAE5' : 'transparent' 
                  }}>
                    <td className="font-bold">#{b.num}</td>
                    <td>{b.plant}</td>
                    <td><span className="density-pill">{b.recipe}</span></td>
                    <td className="num">{b.target}</td>
                    <td className="num">
                      <span style={{ color: b.current >= b.target * 0.95 ? '#16A34A' : '#D97706' }}>
                        {b.current}
                      </span>{' '}
                      <span className="text-[10px] text-slate-400">
                        {Math.round((b.current / b.target) * 100) || 0}%
                      </span>
                    </td>
                    <td className="num">{b.drums}</td>
                    <td className="num text-slate-500">{b.elapsed}</td>
                    <td className="text-slate-500">{b.op}</td>
                    <td>
                      <div className="flex items-center justify-between gap-3">
                        <span className="badge" style={{ background: qc.bg, color: qc.color }}>
                          {b.qc.toUpperCase()}
                        </span>
                        {b.editCount > 1 && (
                          <span
                            className="text-[9px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200 cursor-help relative group font-bold tracking-wide select-none shrink-0"
                            title={`This batch was updated ${b.editCount - 1} times`}
                          >
                            Edited
                            <span className="absolute bottom-full right-0 mb-1 hidden group-hover:block bg-slate-950 text-white text-[10px] px-2 py-1 rounded shadow-lg whitespace-nowrap z-50">
                              Edited {b.editCount - 1} time{b.editCount - 1 !== 1 ? 's' : ''}
                            </span>
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
