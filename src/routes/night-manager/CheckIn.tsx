import React, { useState, useRef, useEffect } from 'react';
import { MentionTextarea } from '../../components/mentions';
import { validateGeofence } from '../../lib/algorithms/geofencing';
import { uploadCheckinPhoto } from '../../lib/cloudinary';
import { insertRows } from '../../lib/db';
import { useMentionNotifier } from '../../lib/mentions';
import { useBlacklistGuard } from '../../lib/blacklist/guard';
import { useRoleContext } from '../../contexts/RoleContext';

// ── Plant config ── Replace with real coordinates before production ──────────
const PLANT_LAT      = 24.1856;
const PLANT_LNG      = 84.0644;
const PLANT_RADIUS_M = 500;
const PLANT_NAME     = 'Rehla (SCPL)';

// ── Types ─────────────────────────────────────────────────────────────────────
type CameraState  = 'idle' | 'requesting' | 'live' | 'captured' | 'cam_error';
type GpsState     = 'idle' | 'loading' | 'done' | 'error';
type SubmitState  = 'idle' | 'uploading' | 'saving' | 'done' | 'error';

interface GpsData {
  lat: number;
  lng: number;
  accuracy: number;
  timestamp: Date;
  isOnSite: boolean;
  statusLabel: string;
  distanceM: number;
}

interface CheckInProps {
  embedded?: boolean;
}

// ── Component ─────────────────────────────────────────────────────────────────
export function CheckIn({ embedded = false }: CheckInProps) {
  // Camera
  const [cameraState, setCameraState]   = useState<CameraState>('idle');
  const [cameraError, setCameraError]   = useState<string | null>(null);
  const [photoBlob, setPhotoBlob]       = useState<Blob | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);  // local blob URL
  const [cloudinaryUrl, setCloudinaryUrl] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);

  const videoRef  = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // Fallback file input for browsers that block getUserMedia
  const fileRef   = useRef<HTMLInputElement>(null);

  // GPS
  const [gpsState, setGpsState] = useState<GpsState>('idle');
  const [gpsData,  setGpsData]  = useState<GpsData | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);

  // Form
  const [note,        setNote]        = useState('');
  const notifyMentions = useMentionNotifier();
  const screenBlacklist = useBlacklistGuard();
  const { activeProfile } = useRoleContext();
  const [submitState, setSubmitState] = useState<SubmitState>('idle');
  const [submitError, setSubmitError] = useState<string | null>(null);

  // ── Attach stream to video element once camera goes live ───────────────────
  useEffect(() => {
    if (cameraState === 'live' && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(console.error);
    }
  }, [cameraState]);

  // ── Stop camera stream on unmount ──────────────────────────────────────────
  useEffect(() => {
    return () => stopCamera();
  }, []);

  function stopCamera() {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }

  // ── Start live camera ──────────────────────────────────────────────────────
  async function startCamera() {
    setCameraError(null);
    setCameraState('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',  // rear camera on mobile
          width:  { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      streamRef.current = stream;
      setCameraState('live');         // triggers useEffect to bind to <video>
    } catch (err) {
      console.warn('getUserMedia failed, falling back to file input:', err);
      setCameraState('cam_error');
      setCameraError(
        (err instanceof Error && err.name === 'NotAllowedError')
          ? 'Camera permission denied. Please allow camera access and try again.'
          : 'Could not access camera. Using file picker instead.'
      );
      // Auto-fallback: open file picker
      setTimeout(() => fileRef.current?.click(), 400);
    }
  }

  // ── Capture snapshot from live video ──────────────────────────────────────
  function capturePhoto() {
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    canvas.width  = video.videoWidth  || 1280;
    canvas.height = video.videoHeight || 720;
    canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        setPhotoBlob(blob);
        // Revoke previous preview URL to avoid memory leaks
        if (photoPreview) URL.revokeObjectURL(photoPreview);
        setPhotoPreview(URL.createObjectURL(blob));
        setCameraState('captured');
        stopCamera();   // free the camera as soon as we have the snap
        fetchGps();     // start GPS simultaneously
      },
      'image/jpeg',
      0.88,
    );
  }

  // ── Retake — restart the camera ───────────────────────────────────────────
  async function retakePhoto() {
    setPhotoBlob(null);
    if (photoPreview) { URL.revokeObjectURL(photoPreview); setPhotoPreview(null); }
    setCloudinaryUrl(null);
    setUploadProgress(0);
    setGpsData(null);
    setGpsState('idle');
    setSubmitState('idle');
    setSubmitError(null);
    await startCamera();
  }

  // ── Fallback: file picker (mobile native camera or desktop gallery) ────────
  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const blob = file as Blob;
    setPhotoBlob(blob);
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoPreview(URL.createObjectURL(blob));
    setCameraState('captured');
    fetchGps();
  }

  // ── GPS fetch ──────────────────────────────────────────────────────────────
  function fetchGps() {
    if (!navigator.geolocation) {
      setGpsState('error');
      setGpsError('Geolocation not supported by this browser.');
      return;
    }
    setGpsState('loading');
    setGpsError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        const result = validateGeofence(latitude, longitude, PLANT_LAT, PLANT_LNG, PLANT_RADIUS_M);
        setGpsData({
          lat:         latitude,
          lng:         longitude,
          accuracy:    Math.round(accuracy),
          timestamp:   new Date(),
          isOnSite:    result.isOnSite,
          statusLabel: result.statusLabel,
          distanceM:   result.distanceM,
        });
        setGpsState('done');
      },
      (err) => {
        setGpsState('error');
        setGpsError(err.message);
      },
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  }

  // ── Submit: upload → Supabase ──────────────────────────────────────────────
  async function handleSubmit() {
    if (!photoBlob || !gpsData) return;
    if (submitState !== 'idle') return; // double-submit guard

    // Warn if out of zone, but allow override
    if (!gpsData.isOnSite) {
      const ok = window.confirm(
        `⚠️ Out of Zone\n\nYou are ${gpsData.distanceM.toLocaleString()} m away from ${PLANT_NAME}.\n\nThis check-in will be flagged for review. Submit anyway?`
      );
      if (!ok) return;
    }

    setSubmitState('uploading');
    setSubmitError(null);
    setUploadProgress(0);

    // 1 ── Upload to Cloudinary ────────────────────────────────────────────
    let finalPhotoUrl = '';
    try {
      const result = await uploadCheckinPhoto(photoBlob, {
        plantName:  PLANT_NAME,
        lat:        gpsData.lat,
        lng:        gpsData.lng,
        isOnSite:   gpsData.isOnSite,
        creator:    activeProfile.name,
        onProgress: setUploadProgress,
      });
      finalPhotoUrl = result.secure_url;
      setCloudinaryUrl(finalPhotoUrl);
    } catch (err) {
      console.error('Cloudinary upload failed:', err);
      setSubmitError(`Photo upload failed: ${err instanceof Error ? err.message : String(err)}`);
      setSubmitState('error');
      return;
    }

    // 2 ── Save record to Supabase ─────────────────────────────────────────
    setSubmitState('saving');
    const { error: dbError } = await insertRows('shift_logs', {
      photo_url:  finalPhotoUrl,
      lat:        gpsData.lat,
      lng:        gpsData.lng,
      is_on_site: gpsData.isOnSite,
      distance_m: gpsData.distanceM,
    });
    if (dbError) {
      console.error('Supabase insert failed:', dbError);
      setSubmitError(`Check-in saved to cloud but database record failed: ${dbError.message}. Please screenshot this and report to admin.`);
      setSubmitState('error');
      return;
    }

    // 3 ── Notify admin/unit-head ──────────────────────────────────────────
    const zoneLabel = gpsData.isOnSite ? 'On-site ✓' : 'Out-of-zone ⚠️';
    insertRows('notifications', {
      target_roles: ['admin', 'unit_head'],
      title: `Night Manager check-in: ${PLANT_NAME}`,
      body: `${zoneLabel} · ${gpsData.lat.toFixed(4)}, ${gpsData.lng.toFixed(4)}`,
      type: gpsData.isOnSite ? 'info' : 'urgent',
      route: '/dashboard/night-manager',
      actor_name: PLANT_NAME,
      actor_role: 'night_manager',
    }).then(() => {}, () => {}); // non-blocking

    // Tag anyone @-mentioned in the shift note.
    notifyMentions(note, { entityLabel: `Night check-in · ${PLANT_NAME}`, route: '/dashboard/night-manager' });

    // If the person checking in is themselves on the blacklist, alert admin.
    await screenBlacklist(
      [{ value: activeProfile.name, label: 'Night Manager' }],
      { workflow: 'Night Check-in', source: 'image', entityLabel: PLANT_NAME, imageUrl: finalPhotoUrl || null },
    );

    setSubmitState('done');
  }

  const canSubmit = photoBlob !== null && gpsState === 'done' && submitState === 'idle';

  // ── Success screen ─────────────────────────────────────────────────────────
  if (submitState === 'done') {
    return (
      <div
        className={embedded
          ? 'flex items-center justify-center py-16 px-4'
          : 'min-h-screen flex items-center justify-center p-4'}
        style={embedded ? {} : { background: '#f8fafc' }}
      >
        <div className="text-center max-w-sm mx-auto w-full">
          {/* Cloudinary thumbnail */}
          {cloudinaryUrl && (
            <div className="w-32 h-32 rounded-2xl overflow-hidden mx-auto mb-4 border-2 border-green-200 shadow-md">
              <img
                src={cloudinaryUrl.replace('/upload/', '/upload/w_256,h_256,c_fill,q_80/')}
                alt="Check-in"
                className="w-full h-full object-cover"
              />
            </div>
          )}
          <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#16A34A" strokeWidth="2.5">
              <path d="M20 6 9 17l-5-5"/>
            </svg>
          </div>
          <h2 className="text-xl font-extrabold mb-1">Shift Logged ✓</h2>
          <p className="text-sm text-slate-500 mb-1">
            {PLANT_NAME} · {gpsData?.timestamp.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
          </p>
          <div style={{ margin: '10px 0 14px', padding: '10px 14px', background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 12, fontSize: 12, color: '#15803D', textAlign: 'left' }}>
            ✓ Record saved to database · Admin notified
          </div>
          {cloudinaryUrl && (
            <a
              href={cloudinaryUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-500 underline mb-5 inline-block"
            >
              View uploaded photo ↗
            </a>
          )}
          <div className="h-4" />
          <button
            onClick={() => {
              setPhotoBlob(null);
              if (photoPreview) URL.revokeObjectURL(photoPreview);
              setPhotoPreview(null);
              setCloudinaryUrl(null);
              setUploadProgress(0);
              setGpsData(null);
              setGpsState('idle');
              setSubmitState('idle');
              setSubmitError(null);
              setNote('');
              setCameraState('idle');
            }}
            className="w-full py-3 rounded-xl font-bold text-white"
            style={{ background: '#0F172A' }}
          >
            Submit Another Check-in
          </button>
        </div>
      </div>
    );
  }

  // ── Main form ──────────────────────────────────────────────────────────────
  return (
    <div
      className={embedded ? 'pb-6' : 'min-h-screen pb-20'}
      style={embedded ? {} : { background: '#f8fafc', fontFamily: 'Inter, sans-serif' }}
    >
      {/* Standalone header */}
      {!embedded && (
        <header className="bg-white p-5 sticky top-0 z-10 border-b border-slate-100 shadow-sm flex items-center justify-between">
          <div>
            <div className="text-xs font-bold tracking-wider text-blue-600 uppercase mb-0.5">Suntek L1</div>
            <div className="text-lg font-extrabold leading-tight">Night Manager</div>
          </div>
          <div className="w-8 h-8 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center font-bold text-sm">
            AM
          </div>
        </header>
      )}

      <main className={embedded ? 'space-y-5 max-w-xl' : 'p-4 space-y-5 max-w-md mx-auto'}>

        {/* Status banner */}
        <div
          className="p-5 border rounded-2xl"
          style={{
            background:   gpsData?.isOnSite ? '#F0FDF4' : '#FFFBEB',
            borderColor:  gpsData?.isOnSite ? '#BBF7D0' : '#FDE68A',
          }}
        >
          <div className="flex items-center gap-3 mb-1">
            <div
              className="w-2 h-2 rounded-full animate-pulse"
              style={{ background: gpsData?.isOnSite ? '#16A34A' : '#F59E0B' }}
            />
            <div className="font-bold" style={{ color: gpsData?.isOnSite ? '#166534' : '#92400E' }}>
              {gpsData?.isOnSite ? 'On Site — Ready to submit' : 'Pending Check-in'}
            </div>
          </div>
          <div className="text-sm" style={{ color: gpsData?.isOnSite ? '#15803D' : '#B45309' }}>
            {gpsData
              ? gpsData.statusLabel
              : 'Your hourly geo-tagged photo is required for compliance audit.'}
          </div>
        </div>

        {/* ── Camera / Photo card ── */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">

          {/* Preview / viewfinder */}
          <div
            className="relative w-full flex items-center justify-center bg-slate-900"
            style={{ aspectRatio: '16/9', minHeight: '180px' }}
          >
            {/* Live video stream */}
            {cameraState === 'live' && (
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="absolute inset-0 w-full h-full object-cover"
              />
            )}

            {/* Captured photo preview */}
            {cameraState === 'captured' && photoPreview && (
              <img
                src={photoPreview}
                alt="Captured"
                className="absolute inset-0 w-full h-full object-cover"
              />
            )}

            {/* Idle / requesting / error placeholder */}
            {(cameraState === 'idle' || cameraState === 'requesting' || cameraState === 'cam_error') && (
              <div className="flex flex-col items-center justify-center text-slate-500 gap-2 px-6 text-center">
                <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                  <circle cx="12" cy="13" r="4"/>
                </svg>
                <div className="text-sm font-medium text-slate-400">
                  {cameraState === 'requesting'
                    ? 'Requesting camera access…'
                    : cameraState === 'cam_error'
                      ? cameraError
                      : 'Camera not started'}
                </div>
              </div>
            )}

            {/* Live indicator */}
            {cameraState === 'live' && (
              <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-black/50 text-white text-[11px] font-bold px-2.5 py-1 rounded-full">
                <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                LIVE
              </div>
            )}

            {/* Geofence badge on captured photo */}
            {cameraState === 'captured' && gpsData && (
              <div
                className="absolute top-3 left-3 flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full"
                style={{
                  background:  gpsData.isOnSite ? 'rgba(22,163,74,0.85)' : 'rgba(220,38,38,0.85)',
                  color: '#fff',
                }}
              >
                <div className="w-1.5 h-1.5 rounded-full bg-white" />
                {gpsData.isOnSite ? 'On Site' : 'Out of Zone'}
              </div>
            )}
          </div>

          {/* Hidden canvas for snapshot */}
          <canvas ref={canvasRef} className="hidden" />

          {/* Hidden file input — fallback */}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handleFileChange}
          />

          {/* Camera action buttons */}
          <div className="p-4 space-y-3">
            {cameraState === 'idle' && (
              <button
                onClick={startCamera}
                className="w-full text-white font-bold rounded-xl py-4 flex items-center justify-center gap-2 text-base active:scale-95 transition-transform shadow-lg"
                style={{ background: 'linear-gradient(135deg, #3b82f6, #2563eb)', boxShadow: '0 8px 20px -4px rgba(37,99,235,0.4)' }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                  <circle cx="12" cy="13" r="4"/>
                </svg>
                Start Camera
              </button>
            )}

            {cameraState === 'requesting' && (
              <div className="w-full py-4 flex items-center justify-center gap-2 text-slate-500 text-sm font-semibold">
                <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                Requesting camera permission…
              </div>
            )}

            {cameraState === 'live' && (
              <button
                onClick={capturePhoto}
                className="w-full text-white font-bold rounded-xl py-4 flex items-center justify-center gap-2 text-base active:scale-95 transition-transform shadow-lg"
                style={{ background: 'linear-gradient(135deg, #ef4444, #dc2626)', boxShadow: '0 8px 20px -4px rgba(220,38,38,0.4)' }}
              >
                <div className="w-5 h-5 rounded-full bg-white/30 border-2 border-white" />
                Capture Photo
              </button>
            )}

            {cameraState === 'captured' && (
              <button
                onClick={retakePhoto}
                className="w-full font-bold rounded-xl py-3 flex items-center justify-center gap-2 text-sm border border-slate-200 hover:bg-slate-50 transition-colors"
                style={{ color: '#475569' }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M1 4v6h6M23 20v-6h-6"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4-4.64 4.36A9 9 0 0 1 3.51 15"/>
                </svg>
                Retake Photo
              </button>
            )}

            {cameraState === 'cam_error' && (
              <button
                onClick={() => fileRef.current?.click()}
                className="w-full text-white font-bold rounded-xl py-4 flex items-center justify-center gap-2 text-base"
                style={{ background: '#64748B' }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
                </svg>
                Choose Photo from Gallery
              </button>
            )}
          </div>
        </div>

        {/* ── GPS data card ── */}
        <div
          className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 transition-opacity duration-300"
          style={{ opacity: cameraState === 'captured' ? 1 : 0.45 }}
        >
          <h3 className="font-bold mb-4 flex items-center gap-2 text-[15px]">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
              <circle cx="12" cy="10" r="3"/>
            </svg>
            GPS Location
          </h3>

          <div className="space-y-3">
            <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
              <div className="text-xs text-slate-500 mb-1">Timestamp</div>
              <div className="font-medium font-mono text-sm">
                {gpsData ? gpsData.timestamp.toLocaleString('en-IN') : '--:--:--'}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                <div className="text-xs text-slate-500 mb-1">Latitude</div>
                <div className="font-medium font-mono text-sm">
                  {gpsData ? `${gpsData.lat.toFixed(5)}°N` : '--.-----'}
                </div>
              </div>
              <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                <div className="text-xs text-slate-500 mb-1">Longitude</div>
                <div className="font-medium font-mono text-sm">
                  {gpsData ? `${gpsData.lng.toFixed(5)}°E` : '--.-----'}
                </div>
              </div>
            </div>

            {gpsData && (
              <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                <div className="text-xs text-slate-500 mb-1">GPS Accuracy</div>
                <div className="font-medium font-mono text-sm">± {gpsData.accuracy} m</div>
              </div>
            )}

            {/* Geofence status */}
            <div className="bg-slate-50 p-3 rounded-lg border border-slate-100 flex items-center gap-2">
              {gpsState === 'loading' && (
                <>
                  <div className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin shrink-0" />
                  <div className="text-sm font-medium text-blue-600">Fetching GPS…</div>
                </>
              )}
              {gpsState === 'error' && (
                <>
                  <div className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
                  <div className="text-sm font-medium text-red-600">{gpsError}</div>
                </>
              )}
              {gpsState === 'done' && gpsData && (
                <>
                  <div
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ background: gpsData.isOnSite ? '#16A34A' : '#DC2626' }}
                  />
                  <div
                    className="text-sm font-medium"
                    style={{ color: gpsData.isOnSite ? '#15803D' : '#DC2626' }}
                  >
                    {gpsData.statusLabel}
                  </div>
                </>
              )}
              {gpsState === 'idle' && (
                <>
                  <div className="w-2 h-2 rounded-full bg-slate-300 shrink-0" />
                  <div className="text-sm font-medium text-slate-400">Waiting for photo…</div>
                </>
              )}
            </div>

            {cameraState === 'captured' && gpsState !== 'loading' && (
              <button onClick={fetchGps} className="text-xs text-blue-600 font-semibold hover:underline">
                ↺ Refresh GPS
              </button>
            )}
          </div>
        </div>

        {/* ── Note ── */}
        <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
          <label className="block text-xs font-bold text-slate-600 mb-2 uppercase tracking-wide">
            Note (optional)
          </label>
          <MentionTextarea
            value={note}
            onChange={setNote}
            rows={2}
            placeholder="Any observations for this shift… type @ to tag"
            className="w-full p-3 text-sm border border-slate-200 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
        </div>

        {/* ── Upload progress (shown during upload) ── */}
        {(submitState === 'uploading' || submitState === 'saving') && (
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-semibold text-slate-700">
                {submitState === 'uploading'
                  ? `Uploading photo to Cloudinary… ${uploadProgress}%`
                  : 'Saving to database…'}
              </div>
              <div className="text-xs text-slate-400">
                {submitState === 'uploading' ? '1 of 2' : '2 of 2'}
              </div>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
              <div
                className="h-2 rounded-full transition-all duration-300"
                style={{
                  width: submitState === 'saving' ? '100%' : `${uploadProgress}%`,
                  background: 'linear-gradient(90deg, #3b82f6, #2563eb)',
                }}
              />
            </div>
            {submitState === 'uploading' && (
              <div className="text-[11px] text-slate-400 mt-1">
                📍 GPS metadata + plant tag attached to image
              </div>
            )}
          </div>
        )}

        {/* ── Error state ── */}
        {submitState === 'error' && submitError && (
          <div className="bg-red-50 border border-red-200 p-4 rounded-2xl text-sm text-red-700">
            <div className="font-semibold mb-1">Upload failed</div>
            <div>{submitError}</div>
            <button
              onClick={() => { setSubmitState('idle'); setSubmitError(null); setUploadProgress(0); }}
              className="mt-2 text-xs font-bold text-red-600 underline"
            >
              Try again
            </button>
          </div>
        )}

        {/* ── Submit button ── */}
        {submitState !== 'uploading' && submitState !== 'saving' && submitState !== 'error' && (
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="w-full font-bold rounded-xl py-4 text-lg transition-all"
            style={{
              background: canSubmit ? '#10B981' : '#94A3B8',
              color:      '#fff',
              cursor:     canSubmit ? 'pointer' : 'not-allowed',
              boxShadow:  canSubmit ? '0 8px 20px -4px rgba(16,185,129,0.4)' : 'none',
            }}
          >
            Submit Shift Report
          </button>
        )}

        {/* Helper hints */}
        {cameraState === 'idle' && (
          <p className="text-center text-xs text-slate-400">
            Tap "Start Camera" to open the live viewfinder.
          </p>
        )}
        {cameraState === 'captured' && gpsState !== 'done' && (
          <p className="text-center text-xs text-slate-400">
            Waiting for GPS lock before submission is enabled…
          </p>
        )}

      </main>
    </div>
  );
}
