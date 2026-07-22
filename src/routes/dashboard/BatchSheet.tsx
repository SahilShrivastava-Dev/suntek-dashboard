import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useSortable } from '../../components/ui/useSortable';
import { ThV2 as Th } from '../../components/v2';

const QC_BADGE: Record<string, { bg: string; color: string }> = {
  pending:  { bg: '#FEF3C7', color: '#D97706' },
  awaiting: { bg: '#F1F5F9', color: '#475569' },
};

/** Shape consumed by formatBatch — an active_batches row with its joined relations. */
interface BatchSource {
  id: string;
  batch_no?: string;
  recipe?: string | null;
  target_qty?: number | null;
  plants?: { name?: string | null } | null;
  profiles?: { name?: string | null } | null;
  batch_readings?: { id: string }[] | null;
}

function formatBatch(b: BatchSource) {
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

type BatchDisplay = ReturnType<typeof formatBatch>;

export function BatchSheet() {
  const { t } = useTranslation();
  const [liveBatches, setLiveBatches] = useState<BatchDisplay[]>([]);
  const [updateFlash, setUpdateFlash] = useState<string | null>(null);
  const batchSort = useSortable(liveBatches, {
    num: b => b.num,
    plant: b => b.plant,
    recipe: b => b.recipe,
    target: b => b.target,
    current: b => b.current,
    drums: b => b.drums,
    op: b => b.op,
    qc: b => b.qc,
  });

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('active_batches')
        .select('*, profiles(name), plants(name), batch_readings(id)')
        .eq('status', 'active')
        .returns<BatchSource[]>();
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
        const { data: rows } = await supabase
          .from('active_batches')
          .select('*, profiles(name), plants(name), batch_readings(id)')
          .eq('id', payload.new.id)
          .limit(1)
          .returns<BatchSource[]>();
        const data = rows?.[0];

        if (data) {
          const formatted = formatBatch(data);
          setLiveBatches(prev => {
            if (prev.some(b => b.id === formatted.id)) return prev;
            return [formatted, ...prev];
          });
          setUpdateFlash(formatted.id);
          setTimeout(() => setUpdateFlash(null), 3000);
        } else {
          const formatted = formatBatch(payload.new as BatchSource);
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


  return (
    <>
      {/* KPIs */}
      <div className="grid grid-cols-12 gap-5 mb-5">
        <div className="col-span-12 lg:col-span-3 card p-5">
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">{t('batch.activeBatches')}</div>
          <div className="text-[28px] font-extrabold mt-1 num">{liveBatches.length}</div>
          <div className="text-[11px] text-slate-500 mt-1">{t('batch.acrossFactories')}</div>
        </div>
        <div className="col-span-12 lg:col-span-3 card p-5">
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">{t('batch.closedToday')}</div>
          <div className="text-[28px] font-extrabold mt-1 num">3</div>
          <div className="text-[11px] text-slate-500 mt-1">{t('batch.drumsTotal')}</div>
        </div>
        <div className="col-span-12 lg:col-span-3 card p-5">
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">{t('batch.avgYield')}</div>
          <div className="text-[28px] font-extrabold mt-1 num">+0.4%</div>
        </div>
        <div className="col-span-12 lg:col-span-3 card p-5">
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">{t('batch.varianceFlagged')}</div>
          <div className="text-[28px] font-extrabold mt-1 num text-amber-600">1</div>
          <div className="text-[11px] text-amber-600 mt-1">Batch 1228 +2.4%</div>
        </div>
      </div>

      {/* Active batches table — amber-soft */}
      <div className="card2 p-6">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
          <div>
            <div className="text-base font-bold font-heading">{t('batch.activeBatches')}</div>
            <div className="text-xs text-slate-500">{t('batch.liveReadingsSub')}</div>
          </div>
          <Link
            to="/operator/batch-logger"
            className="btn-accent rounded-[10px] px-4 py-2 font-semibold text-sm no-underline inline-block text-center flex items-center justify-center"
          >
            + {t('batch.startBatch')}
          </Link>
        </div>
        <div className="overflow-x-auto scroll-x">
          <table className="dt2">
            <thead>
              <tr>
                <Th sortKey="num" s={batchSort}>{t('batch.colBatchNo')}</Th><Th sortKey="plant" s={batchSort}>{t('common.plant')}</Th><Th sortKey="recipe" s={batchSort}>{t('batch.colRecipe')}</Th>
                <Th sortKey="target" s={batchSort} firstDir="desc" className="num">{t('batch.colTarget')}</Th><Th sortKey="current" s={batchSort} firstDir="desc" className="num">{t('batch.colCurrent')}</Th>
                <Th sortKey="drums" s={batchSort} firstDir="desc" className="num">{t('batch.colDrums')}</Th><th className="num">{t('batch.colElapsed')}</th>
                <Th sortKey="op" s={batchSort}>{t('batch.colOperator')}</Th><Th sortKey="qc" s={batchSort}>{t('batch.colQc')}</Th>
              </tr>
            </thead>
            <tbody>
              {batchSort.sorted.map(b => {
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
                    <td className="num text-slate-500">{b.elapsed === 'Live' ? t('batch.live') : b.elapsed}</td>
                    <td className="text-slate-500">{b.op}</td>
                    <td>
                      <div className="flex items-center justify-between gap-3">
                        <span className="badge" style={{ background: qc.bg, color: qc.color }}>
                          {t(`batch.qc.${b.qc}`, b.qc.toUpperCase())}
                        </span>
                        {b.editCount > 1 && (
                          <span
                            className="text-[9px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200 cursor-help relative group font-bold tracking-wide select-none shrink-0"
                            title={t('batch.editedTimes', { times: b.editCount - 1 })}
                          >
                            {t('batch.edited')}
                            <span className="absolute bottom-full right-0 mb-1 hidden group-hover:block bg-slate-950 text-white text-[10px] px-2 py-1 rounded shadow-lg whitespace-nowrap z-50">
                              {t('batch.editedCount', { times: b.editCount - 1 })}
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
