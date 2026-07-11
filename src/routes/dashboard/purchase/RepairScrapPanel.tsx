import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../../lib/supabase';
import { usePlantScope } from '../../../contexts/PlantScopeContext';
import { withEmbedFallback } from '../../../lib/scopedList';
import { SkeletonRows, EmptyState } from '../../../components/ui/states';
import { ImageLightbox, type LightboxImage } from '../../../components/ui/ImageLightbox';
import { usePagination } from '../../../components/ui/usePagination';
import { TablePagination } from '../../../components/ui/TablePagination';
import { useSortable, Th } from '../../../components/ui/useSortable';
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

  if (loading) return <div className="card p-6" style={{ marginTop: 20 }}><SkeletonRows rows={4} /></div>;
  if (rows.length === 0) return null; // nothing sent to repair/scrap yet → hide the panel entirely

  return (
    <div className="card p-6" style={{ marginTop: 20, position: 'relative' }}>
      <div className="text-base font-bold">Repair &amp; scrap tracking</div>
      <div className="text-xs text-slate-500 mb-3">Assets sent for repair or scrapped at the end of a maintenance job — with photo proof and a link to the ticket.</div>
      <TableSearch value={search} onChange={setSearch} placeholder="Search equipment, plant, ticket…" />
      <RepairScrapTable title="Repair items" accent="#D97706" rows={repair} onOpenTicket={id => navigate(`/dashboard/purchase/maint?ticket=${id}`)} onPhoto={setLightbox} />
      <div style={{ height: 18 }} />
      <RepairScrapTable title="Scrap items" accent="#DC2626" rows={scrap} onOpenTicket={id => navigate(`/dashboard/purchase/maint?ticket=${id}`)} onPhoto={setLightbox} />
      <ImageLightbox images={lightbox || []} open={!!lightbox} onClose={() => setLightbox(null)} />
    </div>
  );
}

function RepairScrapTable({ title, accent, rows, onOpenTicket, onPhoto }: {
  title: string;
  accent: string;
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
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 800, color: accent, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>{title} · {rows.length}</div>
      {rows.length === 0 ? (
        <EmptyState title={`No ${title.toLowerCase()} yet`} />
      ) : (
        <div className="overflow-x-auto scroll-x">
          <table className="dt">
            <thead><tr><Th sortKey="equipment" s={s}>Equipment</Th><Th sortKey="plant" s={s}>Plant</Th><Th sortKey="ticket" s={s}>Ticket #</Th><Th sortKey="closed" s={s} firstDir="desc">Closed</Th><Th sortKey="status" s={s}>Status</Th><th>Photo</th></tr></thead>
            <tbody>
              {pageRows.map(r => (
                <tr key={r.id}>
                  <td className="font-semibold">{r.equipment}</td>
                  <td>{r.plants?.name || '—'}</td>
                  <td><button type="button" onClick={() => onOpenTicket(r.id)} className="num text-xs" style={{ color: '#2563EB', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'underline' }} title="Open maintenance ticket">#{r.id.slice(0, 8)}</button></td>
                  <td className="text-slate-500 text-xs">{fmtDate(r.closed_at)}</td>
                  <td><span className="badge" style={{ background: '#F1F5F9', color: '#475569', fontWeight: 700 }}>{r.status}</span></td>
                  <td>{r.defective_part_photo_url
                    ? <button type="button" onClick={() => onPhoto([{ url: r.defective_part_photo_url as string, label: r.equipment }])} style={{ color: '#2563EB', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, textDecoration: 'underline' }}>View</button>
                    : <span className="text-slate-300">—</span>}</td>
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
