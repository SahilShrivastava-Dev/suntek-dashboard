import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Wrench, Trash2 } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { usePlantScope } from '../../../contexts/PlantScopeContext';
import { withEmbedFallback } from '../../../lib/scopedList';
import { SkeletonRows, EmptyState } from '../../../components/ui/states';
import { ImageLightbox, type LightboxImage } from '../../../components/ui/ImageLightbox';
import { usePagination } from '../../../components/ui/usePagination';
import { TablePaginationV2 as TablePagination } from '../../../components/v2';
import { useSortable } from '../../../components/ui/useSortable';
import { ThV2 as Th, StatusPill } from '../../../components/v2';
import { TableSearch, useTextFilter } from '../../../components/ui/TableSearch';
import type { Database } from '../../../lib/database.types';

type TicketRow = Database['public']['Tables']['maintenance_tickets']['Row'] & { plants?: { name: string | null } | null };

const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

/**
 * Repair & scrap tracking — where a maintenance job's defective part ended up.
 * Sourced from maintenance_tickets.defective_part_decision ('repair' | 'scrap'), the
 * value written when the emergency ticket is closed. Gives users the dedicated place
 * (missing before) to monitor assets after maintenance: under repair vs scrapped, with
 * photo proof and a deep link to the originating ticket.
 */
export function RepairScrapPanel() {
  const navigate = useNavigate();
  const { scopeQuery } = usePlantScope();
  const [rows, setRows] = useState<TicketRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [lightbox, setLightbox] = useState<LightboxImage[] | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await withEmbedFallback(
        scopeQuery(supabase.from('maintenance_tickets').select('*, plants(name)'), { unitCol: 'unit_id' })
          .not('defective_part_decision', 'is', null).order('closed_at', { ascending: false }).returns<TicketRow[]>(),
        () => scopeQuery(supabase.from('maintenance_tickets').select('*'), { unitCol: 'unit_id' })
          .not('defective_part_decision', 'is', null).order('closed_at', { ascending: false }).returns<TicketRow[]>(),
        'RepairScrap.tickets',
      );
      if (!alive) return;
      setRows(data || []);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [scopeQuery]);

  const filtered = useTextFilter(rows, search, r => [r.equipment, r.plants?.name, r.id.slice(0, 8), r.assigned_to]);
  const repair = useMemo(() => filtered.filter(r => r.defective_part_decision === 'repair'), [filtered]);
  const scrap = useMemo(() => filtered.filter(r => r.defective_part_decision === 'scrap'), [filtered]);

  if (loading) return <div className="card2 p-6" style={{ marginTop: 20 }}><SkeletonRows rows={4} /></div>;
  if (rows.length === 0) return null; // nothing sent to repair/scrap yet → hide the panel entirely

  return (
    <div className="card2 p-6" style={{ marginTop: 20, position: 'relative' }}>
      <div className="text-base font-bold font-heading">Repair &amp; scrap tracking</div>
      <div className="text-xs text-slate-500 mb-3">Assets sent for repair or scrapped at the end of a maintenance job — with photo proof and a link to the ticket.</div>
      <TableSearch value={search} onChange={setSearch} placeholder="Search equipment, plant, ticket…" />
      <RepairScrapTable title="Repair items" tone="amber" icon={<Wrench size={14} />} rows={repair} onOpenTicket={id => navigate(`/dashboard/purchase/maint?ticket=${id}`)} onPhoto={setLightbox} />
      <div style={{ height: 20 }} />
      <RepairScrapTable title="Scrap items" tone="red" icon={<Trash2 size={14} />} rows={scrap} onOpenTicket={id => navigate(`/dashboard/purchase/maint?ticket=${id}`)} onPhoto={setLightbox} />
      <ImageLightbox images={lightbox || []} open={!!lightbox} onClose={() => setLightbox(null)} />
    </div>
  );
}

function RepairScrapTable({ title, tone, icon, rows, onOpenTicket, onPhoto }: {
  title: string;
  tone: 'amber' | 'red';
  icon: React.ReactNode;
  rows: TicketRow[];
  onOpenTicket: (id: string) => void;
  onPhoto: (imgs: LightboxImage[]) => void;
}) {
  const s = useSortable(rows, {
    equipment: r => r.equipment,
    plant: r => r.plants?.name,
    ticket: r => r.id,
    closed: r => (r.closed_at ? new Date(r.closed_at) : null),
    status: r => r.status,
  }, { key: 'closed', dir: 'desc' });
  const { pageRows, controls } = usePagination(s.sorted, { initialPageSize: 10, resetKey: `${rows.length}|${s.sort.key}|${s.sort.dir}` });
  const iconSq = tone === 'amber' ? 'bg-amber-50 text-amber-600' : 'bg-red-50 text-red-600';
  return (
    <div className="border border-slate-200 rounded-[12px] overflow-hidden">
      {/* Section header — icon square + Poppins title + count pill */}
      <div className="flex items-center gap-2.5 px-4 py-3 bg-slate-50/60 border-b border-slate-100">
        <span className={`w-7 h-7 rounded-lg inline-flex items-center justify-center shrink-0 ${iconSq}`}>{icon}</span>
        <span className="font-heading font-semibold text-[14px] text-slate-800">{title}</span>
        <StatusPill tone={tone} label={rows.length} className="ml-1" />
      </div>
      {rows.length === 0 ? (
        <div className="p-4"><EmptyState title={`No ${title.toLowerCase()} yet`} /></div>
      ) : (
        <div className="overflow-x-auto scroll-x">
          <table className="dt2">
            <thead><tr><Th sortKey="equipment" s={s}>Equipment</Th><Th sortKey="plant" s={s}>Plant</Th><Th sortKey="ticket" s={s}>Ticket #</Th><Th sortKey="closed" s={s} firstDir="desc">Closed</Th><Th sortKey="status" s={s}>Status</Th><th>Photo</th></tr></thead>
            <tbody>
              {pageRows.map(r => (
                <tr key={r.id} onClick={() => onOpenTicket(r.id)} style={{ cursor: 'pointer' }} title="Open maintenance ticket">
                  <td className="font-semibold">{r.equipment}</td>
                  <td className="text-slate-500">{r.plants?.name || '—'}</td>
                  <td><span className="num text-xs text-blue-600 font-semibold">#{r.id.slice(0, 8)}</span></td>
                  <td className="text-slate-500">{fmtDate(r.closed_at)}</td>
                  <td><StatusPill tone={r.status === 'closed' ? 'green' : 'slate'} label={r.status} /></td>
                  <td>
                    {r.defective_part_photo_url ? (
                      <button
                        type="button"
                        onClick={e => { e.stopPropagation(); onPhoto([{ url: r.defective_part_photo_url as string, label: r.equipment }]); }}
                        title="View photo"
                        style={{ padding: 0, border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden', cursor: 'pointer', background: 'none', lineHeight: 0 }}
                      >
                        <img src={r.defective_part_photo_url} alt={`${r.equipment} photo`} style={{ width: 40, height: 40, objectFit: 'cover', display: 'block' }} loading="lazy" />
                      </button>
                    ) : <span className="text-slate-300">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <TablePagination controls={controls} />
        </div>
      )}
    </div>
  );
}
