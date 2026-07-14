import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../../lib/supabase';
import { usePlantScope } from '../../../contexts/PlantScopeContext';
import { withEmbedFallback } from '../../../lib/scopedList';
import { SlidePanel } from '../../../components/SlidePanel';
import { AssetQRCard } from '../../../components/AssetQRCard';
import { usePagination } from '../../../components/ui/usePagination';
import { TablePagination } from '../../../components/ui/TablePagination';
import { ErrorState } from '../../../components/ui/states';
import { normMark } from '../../../lib/far/assets';
import type { Database } from '../../../lib/database.types';

type AssetRow = Database['public']['Tables']['fixed_assets']['Row'] & { plants?: { name: string | null } | null };
type SortKey = 'name' | 'mark' | 'plant' | 'status';
const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'name', label: 'Asset' },
  { key: 'mark', label: 'Mark' },
  { key: 'plant', label: 'Plant' },
  { key: 'status', label: 'QR status' },
];

function fmtDate(d: string | null | undefined) {
  return d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
}

/**
 * QR Management — the hub for generating, printing and downloading asset QR codes.
 * QR is opt-in per asset (no code until generated); this lists every asset in
 * scope with its QR status and lets an authorised user manage it. Access is
 * route-gated (DashboardLayout); generation itself is gated by `generate_asset_qr`
 * inside AssetQRCard.
 */
export function QRManagement() {
  const navigate = useNavigate();
  const { scopeQuery } = usePlantScope();
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState('');
  const [plantFilter, setPlantFilter] = useState<string>(''); // '' = all
  const [selected, setSelected] = useState<AssetRow | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'name', dir: 'asc' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setError(false);
      const { data, error } = await withEmbedFallback(
        scopeQuery(supabase.from('fixed_assets').select('*, plants(name)')).order('name').returns<AssetRow[]>(),
        () => scopeQuery(supabase.from('fixed_assets').select('*')).order('name').returns<AssetRow[]>(),
        'QR.assets',
      );
      if (cancelled) return;
      if (error) { setError(true); setLoading(false); return; }
      setAssets(data || []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [scopeQuery]);

  const plantNames = useMemo(
    () => [...new Set(assets.map(a => a.plants?.name).filter(Boolean) as string[])].sort(),
    [assets],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const nq = normMark(search);
    return assets.filter(a => {
      if (plantFilter && a.plants?.name !== plantFilter) return false;
      if (!q) return true;
      return (a.name || '').toLowerCase().includes(q)
        || (a.identification_mark || '').toLowerCase().includes(q)
        || (!!nq && normMark(a.identification_mark).includes(nq))
        || (a.make || '').toLowerCase().includes(q);
    });
  }, [assets, search, plantFilter]);

  const sorted = useMemo(() => {
    const dir = sort.dir === 'asc' ? 1 : -1;
    const val = (a: AssetRow): string => {
      switch (sort.key) {
        case 'mark':   return normMark(a.identification_mark);
        case 'plant':  return (a.plants?.name || '').toLowerCase();
        case 'status': return a.qr_token ? `1${a.qr_generated_at || ''}` : '0'; // ungenerated sort first asc
        default:       return (a.name || '').toLowerCase();
      }
    };
    return [...filtered].sort((a, b) => val(a).localeCompare(val(b)) * dir);
  }, [filtered, sort]);

  const { pageRows, controls } = usePagination(sorted, { initialPageSize: 10, resetKey: `${search}|${plantFilter}|${sort.key}|${sort.dir}` });

  function toggleSort(key: SortKey) {
    setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' });
  }

  const generatedCount = useMemo(() => assets.filter(a => a.qr_token).length, [assets]);

  // Reflect a generate/regenerate back into the list + the open panel.
  function applyPatch(id: string, patch: { qr_token: string; qr_generated_at: string; qr_generated_by: string }) {
    setAssets(prev => prev.map(a => a.id === id ? { ...a, ...patch } : a));
    setSelected(s => (s && s.id === id ? { ...s, ...patch } : s));
  }

  const statusBadge = (a: AssetRow) => a.qr_token
    ? <span className="badge" style={{ background: '#DCFCE7', color: '#16A34A', fontWeight: 700 }}>✓ {fmtDate(a.qr_generated_at)}</span>
    : <span className="badge" style={{ background: '#F1F5F9', color: '#64748B', fontWeight: 600 }}>Not generated</span>;

  return (
    <div className="card p-5 mb-5">
      <div className="flex items-start justify-between gap-4 mb-1 flex-wrap">
        <div>
          <div className="text-base font-bold">Asset QR Codes</div>
          <div className="text-xs text-slate-500">Generate, print and download a QR code for any asset. Scanning it opens the asset's digital profile.</div>
        </div>
        <div className="text-xs text-slate-500 whitespace-nowrap">{generatedCount} of {assets.length} assets have a QR</div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap mt-4 mb-3">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search asset name or mark…"
          style={{ flex: 1, minWidth: 220, padding: '8px 12px', border: '1px solid #E2E8F0', borderRadius: 10, fontSize: 13, outline: 'none', fontFamily: 'inherit' }}
        />
        {plantNames.length > 1 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {['', ...plantNames].map(p => (
              <button
                key={p || 'all'}
                onClick={() => setPlantFilter(p)}
                className={`chip${plantFilter === p ? ' chip-active' : ''}`}
                style={plantFilter === p ? { background: '#0F172A', color: '#fff', fontWeight: 700 } : { fontWeight: 600 }}
              >
                {p || 'All plants'}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Sort bar — chips wrap on mobile */}
      <div className="flex items-center gap-1.5 flex-wrap mb-3" style={{ fontSize: 12 }}>
        <span style={{ color: '#94A3B8', fontWeight: 600, marginRight: 2 }}>Sort:</span>
        {SORT_OPTIONS.map(o => {
          const on = sort.key === o.key;
          return (
            <button key={o.key} onClick={() => toggleSort(o.key)} className="chip"
              style={on ? { background: '#0F172A', color: '#fff', fontWeight: 700 } : { fontWeight: 600 }}>
              {o.label}{on ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ''}
            </button>
          );
        })}
      </div>

      {/* Responsive card list — no horizontal scroll; content wraps on narrow screens */}
      {error ? (
        <ErrorState title="Couldn't load assets" message="The fixed asset register failed to load." />
      ) : loading ? (
        <div style={{ padding: '28px 0', textAlign: 'center', color: '#94A3B8', fontSize: 13 }}>Loading assets…</div>
      ) : pageRows.length === 0 ? (
        <div style={{ padding: '28px 0', textAlign: 'center', color: '#94A3B8', fontSize: 13 }}>No assets match your search.</div>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {pageRows.map(a => (
              <div
                key={a.id}
                onClick={() => setSelected(a)}
                style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '12px 14px', border: '1px solid #E2E8F0', borderRadius: 12, cursor: 'pointer', background: '#fff' }}
              >
                <div style={{ flex: '1 1 180px', minWidth: 0 }}>
                  <div className="font-semibold text-slate-700" style={{ fontSize: 13.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.name}</div>
                  <div className="text-slate-500" style={{ fontSize: 11, marginTop: 2 }}>{a.identification_mark || '—'} · {a.plants?.name || '—'}</div>
                </div>
                <div style={{ flexShrink: 0 }}>{statusBadge(a)}</div>
                <button className="chip" style={{ fontWeight: 600, flexShrink: 0 }} onClick={(e) => { e.stopPropagation(); setSelected(a); }}>
                  {a.qr_token ? 'Manage QR' : 'Generate'}
                </button>
              </div>
            ))}
          </div>
          <TablePagination controls={controls} label="assets" />
        </>
      )}

      {/* Manage panel */}
      <SlidePanel
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected ? `${selected.name}${selected.identification_mark ? ` · ${selected.identification_mark}` : ''}` : 'Asset QR'}
        subtitle={selected?.plants?.name || 'Fixed asset'}
      >
        {selected && (
          <div>
            <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 12, padding: 12, marginBottom: 16, fontSize: 12, color: '#475569' }}>
              <div>#{selected.id.slice(0, 8)} · {selected.name}</div>
              {selected.make && <div style={{ marginTop: 2 }}>Make: {selected.make}</div>}
              {selected.model && <div style={{ marginTop: 2 }}>Model: {selected.model}</div>}
            </div>

            <AssetQRCard asset={selected} onUpdated={(patch) => applyPatch(selected.id, patch)} />

            <button
              onClick={() => navigate(`/asset/${selected.qr_token ?? selected.id}`)}
              style={{ width: '100%', marginTop: 14, padding: '10px', borderRadius: 12, border: '1px solid #E2E8F0', background: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: 13, fontFamily: 'inherit' }}
            >
              Open full profile ↗
            </button>
          </div>
        )}
      </SlidePanel>
    </div>
  );
}
