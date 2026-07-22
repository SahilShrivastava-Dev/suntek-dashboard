import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { QRCodeCanvas, QRCodeSVG } from 'qrcode.react';
import {
  ArrowLeft, Download, Printer, Share2, RotateCw,
  Tag, CreditCard, LayoutGrid, MapPin, Clock, CalendarDays, Wrench,
} from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { useRoleContext } from '../../../contexts/RoleContext';
import { useToast } from '../../../components/ui/toast';
import { ErrorState } from '../../../components/ui/states';
import { AssetQRCard } from '../../../components/AssetQRCard';
import { ButtonV2, StatusPill, InfoBanner } from '../../../components/v2';
import { assetQrUrl, downloadDataUrl, printQrLabel, safeFileName } from '../../../lib/far/qr';
import type { Database } from '../../../lib/database.types';

type AssetRow = Database['public']['Tables']['fixed_assets']['Row'] & { plants?: { name: string | null } | null };

function fmtDate(d: string | null | undefined) {
  return d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
}

/** One "Asset Details" row — icon + gray label left, value right (per mockup). */
function DetailRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3.5 border-b border-slate-100 last:border-0">
      <span className="flex items-center gap-2.5 text-[13px] text-slate-500 shrink-0">
        <span className="text-slate-400 inline-flex [&>svg]:w-4 [&>svg]:h-4">{icon}</span>
        {label}
      </span>
      <span className="text-[13px] font-medium text-slate-800 text-right min-w-0 truncate">{value}</span>
    </div>
  );
}

/**
 * Full-page QR detail (/dashboard/purchase/qr/:qrKey) — replaces the old
 * in-page SlidePanel on the QR list. Resolves the asset by qr_token first,
 * then by id (so un-generated assets deep-link too). Generation stays gated
 * by `generate_asset_qr` (via AssetQRCard's prompt for token-less assets).
 */
export function QRDetail() {
  const { qrKey } = useParams<{ qrKey: string }>();
  const navigate = useNavigate();
  const { can, activeProfile } = useRoleContext();
  const toast = useToast();
  const canvasWrapRef = useRef<HTMLDivElement>(null);

  const [asset, setAsset] = useState<AssetRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [lastMaint, setLastMaint] = useState<string | null>(null);
  const [nextMaint, setNextMaint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!qrKey) { setNotFound(true); setLoading(false); return; }
      setLoading(true); setNotFound(false);
      // qr_token first, then id (mirrors AssetProfile resolution).
      let { data } = await supabase.from('fixed_assets').select('*, plants(name)')
        .eq('qr_token', qrKey).maybeSingle<AssetRow>();
      if (!data && /^[0-9a-f-]{36}$/i.test(qrKey)) {
        const byId = await supabase.from('fixed_assets').select('*, plants(name)')
          .eq('id', qrKey).maybeSingle<AssetRow>();
        data = byId.data;
      }
      if (cancelled) return;
      if (!data) { setNotFound(true); setLoading(false); return; }
      setAsset(data);
      setLoading(false);

      // Maintenance context (best-effort): last closed ticket + next schedule due.
      const tk = await supabase.from('maintenance_tickets').select('closed_at').eq('far_asset_id', data.id)
        .not('closed_at', 'is', null).order('closed_at', { ascending: false }).limit(1)
        .returns<{ closed_at: string }[]>();
      if (cancelled) return;
      setLastMaint(tk.data?.[0]?.closed_at ?? null);
      if (data.identification_mark) {
        const sc = await supabase.from('maintenance_schedules').select('next_due_at')
          .ilike('equipment', `%${data.identification_mark}%`).eq('is_active', true)
          .order('next_due_at', { ascending: true }).limit(1)
          .returns<{ next_due_at: string }[]>();
        if (cancelled) return;
        setNextMaint(sc.data?.[0]?.next_due_at ?? null);
      }
    })();
    return () => { cancelled = true; };
  }, [qrKey]);

  function getPng(): string | null {
    const canvas = canvasWrapRef.current?.querySelector('canvas');
    return canvas ? canvas.toDataURL('image/png') : null;
  }
  const label = asset ? `${asset.name}${asset.identification_mark ? ` (${asset.identification_mark})` : ''}` : '';

  function download() {
    const png = getPng();
    if (!png) { toast.error('QR not ready yet'); return; }
    downloadDataUrl(png, `QR-${safeFileName(label)}.png`);
  }
  function print() {
    const png = getPng();
    if (!png) { toast.error('QR not ready yet'); return; }
    printQrLabel({ pngDataUrl: png, title: label, subtitle: asset?.plants?.name || '', footer: `Asset #${asset?.id.slice(0, 8)} · scan to open the digital profile` });
  }

  if (loading) {
    return <div className="card2 py-16 text-center text-slate-400 text-[13px]">Loading asset…</div>;
  }
  if (notFound || !asset) {
    return (
      <div className="card2 p-6">
        <ErrorState title="Asset not found" message="This QR link doesn't match any asset in the register." />
        <div className="flex justify-center mt-4">
          <ButtonV2 variant="outline" icon={<ArrowLeft />} onClick={() => navigate('/dashboard/purchase/qr')}>Back to QR Codes</ButtonV2>
        </div>
      </div>
    );
  }

  const url = asset.qr_token ? assetQrUrl(asset.qr_token) : null;

  return (
    <div className="card2 overflow-hidden">
      {/* Inner breadcrumb + back */}
      <div className="flex items-center justify-between gap-3 flex-wrap px-6 py-4 border-b border-slate-100">
        <div className="text-[12.5px] text-slate-400 flex items-center gap-1.5 flex-wrap">
          <span>Factory</span><span className="text-slate-300">›</span>
          <span>Assets</span><span className="text-slate-300">›</span>
          <span>Fixed Asset Register</span><span className="text-slate-300">›</span>
          <span className="text-slate-600 font-medium">{label}</span><span className="text-slate-300">›</span>
          <span className="text-slate-600 font-medium">QR Code</span>
        </div>
        <ButtonV2 variant="outline" icon={<ArrowLeft />} onClick={() => navigate('/dashboard/purchase/qr')}>
          Back to asset
        </ButtonV2>
      </div>

      <div className="grid grid-cols-12 gap-8 p-6">
        {/* ── Left: the QR itself ── */}
        <div className="col-span-12 lg:col-span-7">
          <div className="font-heading font-semibold text-[18px]">Asset QR Code</div>
          <div className="text-[13px] text-slate-500 mt-0.5 mb-4">Scan this QR code to view asset details.</div>

          {url ? (
            <>
              {/* Off-screen high-res canvas used only for PNG export / print */}
              <div ref={canvasWrapRef} style={{ position: 'absolute', left: -99999, top: -99999 }} aria-hidden>
                <QRCodeCanvas value={url} size={512} level="M" marginSize={2} />
              </div>
              <div className="border border-slate-200 rounded-[12px] p-8 flex items-center justify-center bg-white">
                <QRCodeSVG value={url} size={280} level="M" marginSize={2} />
              </div>
              <div className="flex items-center gap-2 flex-wrap mt-4">
                <ButtonV2 variant="primary" icon={<Download />} onClick={download}>Download</ButtonV2>
                <ButtonV2 variant="outline" icon={<Printer />} onClick={print}>Print</ButtonV2>
                <ButtonV2 variant="outline" icon={<Share2 />} onClick={() => navigate(`/asset/${asset.qr_token}`)}>Open Full Profile</ButtonV2>
                {can('generate_asset_qr') && (
                  <ButtonV2
                    variant="outline" icon={<RotateCw />} disabled={busy}
                    className="text-red-600 border-red-200 hover:bg-red-50 hover:border-red-300"
                    onClick={async () => {
                      if (!window.confirm('Regenerate this QR code?\n\nThe current printed code will STOP working and must be reprinted and re-attached.')) return;
                      setBusy(true);
                      try {
                        const { makeQrToken } = await import('../../../lib/far/qr');
                        const { updateRows } = await import('../../../lib/db');
                        const patch = { qr_token: makeQrToken(), qr_generated_at: new Date().toISOString(), qr_generated_by: activeProfile.name };
                        await updateRows('fixed_assets', patch).eq('id', asset.id);
                        setAsset(a => a ? { ...a, ...patch } : a);
                        navigate(`/dashboard/purchase/qr/${patch.qr_token}`, { replace: true });
                        toast.success('QR regenerated — reprint & reattach');
                      } catch (e) {
                        toast.error(`Failed: ${e instanceof Error ? e.message : String(e)}`);
                      } finally { setBusy(false); }
                    }}
                  >
                    Regenerate
                  </ButtonV2>
                )}
              </div>
              <InfoBanner className="mt-4">Anyone can scan this QR code to view asset basic information.</InfoBanner>
            </>
          ) : (
            // No QR yet — reuse the gated generate prompt; onUpdated patches in the new token.
            <AssetQRCard
              asset={asset}
              onUpdated={(patch) => {
                setAsset(a => a ? { ...a, ...patch } : a);
                navigate(`/dashboard/purchase/qr/${patch.qr_token}`, { replace: true });
              }}
            />
          )}
        </div>

        {/* ── Right: asset details ── */}
        <div className="col-span-12 lg:col-span-5">
          <div className="font-heading font-semibold text-[18px] mb-2">Asset Details</div>
          <DetailRow icon={<Tag />} label="Asset Name" value={label} />
          <DetailRow icon={<CreditCard />} label="Asset ID" value={asset.identification_mark || `#${asset.id.slice(0, 8)}`} />
          <DetailRow icon={<LayoutGrid />} label="Category" value={asset.account_head || asset.make || '—'} />
          <DetailRow icon={<MapPin />} label="Location" value={asset.plants?.name || '—'} />
          <DetailRow icon={<Clock />} label="Status" value={<StatusPill tone="green" label="Active" />} />
          <DetailRow icon={<CalendarDays />} label="Installed On" value={asset.purchase_date ? fmtDate(asset.purchase_date) : (asset.year ?? '—')} />
          <DetailRow icon={<Wrench />} label="Last Maintenance" value={fmtDate(lastMaint)} />
          <DetailRow icon={<CalendarDays />} label="Next Maintenance" value={fmtDate(nextMaint)} />
        </div>
      </div>
    </div>
  );
}
