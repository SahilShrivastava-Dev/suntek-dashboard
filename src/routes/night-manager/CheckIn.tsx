import React, { useState, useRef } from 'react';
import { validateGeofence } from '../../lib/algorithms/geofencing';
import { supabase } from '../../lib/supabase';

// ⚠️ Replace with real plant coordinates before production.
// Current values are placeholder centroids.
const PLANT_LAT = 24.1856;
const PLANT_LNG = 84.0644;
const PLANT_RADIUS_M = 500;
const PLANT_NAME = 'Rehla (SCPL)';

type GpsState = 'idle' | 'loading' | 'done' | 'error';
type SubmitState = 'idle' | 'submitting' | 'done';

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
  /** When true, the standalone header is hidden so the component can be
   *  embedded inside the main dashboard layout. */
  embedded?: boolean;
}

export function CheckIn({ embedded = false }: CheckInProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [gpsState, setGpsState] = useState<GpsState>('idle');
  const [gpsData, setGpsData] = useState<GpsData | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [submitState, setSubmitState] = useState<SubmitState>('idle');
  const [note, setNote] = useState('');

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPhotoUrl(url);
    // Trigger GPS automatically after photo is taken
    fetchGps();
  }

  function fetchGps() {
    if (!navigator.geolocation) {
      setGpsState('error');
      setGpsError('Geolocation is not supported by this browser.');
      return;
    }
    setGpsState('loading');
    setGpsError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        const result = validateGeofence(latitude, longitude, PLANT_LAT, PLANT_LNG, PLANT_RADIUS_M);
        setGpsData({
          lat: latitude,
          lng: longitude,
          accuracy: Math.round(accuracy),
          timestamp: new Date(),
          isOnSite: result.isOnSite,
          statusLabel: result.statusLabel,
          distanceM: result.distanceM,
        });
        setGpsState('done');
      },
      (err) => {
        setGpsState('error');
        setGpsError(err.message);
      },
      { enableHighAccuracy: true, timeout: 15_000 }
    );
  }

  async function handleSubmit() {
    if (!photoUrl || !gpsData) return;
    setSubmitState('submitting');
    
    let ipAddress: string | null = null;
    try {
      const res = await fetch('https://api.ipify.org?format=json');
      if (res.ok) {
        const data = await res.json();
        ipAddress = data.ip;
      }
    } catch (err) {
      console.warn('Failed to fetch public IP address:', err);
    }
    
    try {
      const { error } = await (supabase.from('shift_logs') as any).insert({
        photo_url: photoUrl, // We'll just store the local blob URL for prototyping instead of full storage upload
        lat: gpsData.lat,
        lng: gpsData.lng,
        is_on_site: gpsData.isOnSite,
        distance_m: gpsData.distanceM,
        ip_address: ipAddress,
        // Optional: employee_id, plant_id (omitted for now since we lack auth context)
      });
      
      if (error) {
        console.error('Error inserting shift log:', error);
        alert(`Failed to sync to database: ${error.message}`);
      }
    } catch (e) {
      console.error(e);
    }
    
    setSubmitState('done');
  }

  const canSubmit = photoUrl && gpsState === 'done' && submitState === 'idle';

  if (submitState === 'done') {
    return (
      <div className={embedded ? 'flex items-center justify-center py-16 px-4' : 'min-h-screen flex items-center justify-center p-4'} style={embedded ? {} : { background: '#f8fafc' }}>
        <div className="text-center max-w-sm mx-auto">
          <div className="w-20 h-20 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#16A34A" strokeWidth="2.5">
              <path d="M20 6 9 17l-5-5"/>
            </svg>
          </div>
          <h2 className="text-xl font-extrabold mb-1">Shift Logged ✓</h2>
          <p className="text-sm text-slate-500 mb-6">
            Your check-in has been recorded for {PLANT_NAME} at{' '}
            {new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}.
          </p>
          <button
            onClick={() => {
              setPhotoUrl(null);
              setGpsData(null);
              setGpsState('idle');
              setSubmitState('idle');
              setNote('');
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

  return (
    <div className={embedded ? 'pb-6' : 'min-h-screen pb-20'} style={embedded ? {} : { background: '#f8fafc', fontFamily: 'Inter, sans-serif' }}>

      {/* Standalone-only header — hidden when embedded in the dashboard */}
      {!embedded && (
        <header className="bg-white p-5 sticky top-0 z-10 border-b border-slate-100 shadow-sm flex items-center justify-between">
          <div>
            <div className="text-xs font-bold tracking-wider text-blue-600 uppercase mb-0.5">Suntek L1</div>
            <div className="text-lg font-extrabold leading-tight">Night Manager</div>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center font-bold text-sm">
              AM
            </div>
          </div>
        </header>
      )}

      <main className={embedded ? 'space-y-5 max-w-xl' : 'p-4 space-y-5 max-w-md mx-auto'}>

        {/* Status pill */}
        <div
          className="p-5 border rounded-2xl"
          style={{
            background: gpsData?.isOnSite ? '#F0FDF4' : '#FFFBEB',
            borderColor: gpsData?.isOnSite ? '#BBF7D0' : '#FDE68A',
            backdropFilter: 'blur(10px)',
          }}
        >
          <div className="flex items-center gap-3 mb-1">
            <div
              className="w-2 h-2 rounded-full animate-pulse"
              style={{ background: gpsData?.isOnSite ? '#16A34A' : '#F59E0B' }}
            />
            <div
              className="font-bold"
              style={{ color: gpsData?.isOnSite ? '#166534' : '#92400E' }}
            >
              {gpsData?.isOnSite ? 'On Site — Ready to submit' : 'Pending Check-in'}
            </div>
          </div>
          <div className="text-sm" style={{ color: gpsData?.isOnSite ? '#15803D' : '#B45309' }}>
            {gpsData
              ? gpsData.statusLabel
              : 'Your hourly geo-tagged photo is required for compliance audit.'}
          </div>
        </div>

        {/* Camera capture */}
        <div className="bg-white p-6 text-center rounded-2xl shadow-sm border border-slate-100">
          {/* Preview area */}
          <div
            className="w-full rounded-xl mb-4 border-2 border-dashed border-slate-300 flex flex-col items-center justify-center text-slate-400 overflow-hidden relative"
            style={{ aspectRatio: '16/9', background: '#F8FAFC' }}
          >
            {photoUrl ? (
              <img src={photoUrl} className="absolute inset-0 w-full h-full object-cover" alt="Preview" />
            ) : (
              <>
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mb-2">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                  <circle cx="12" cy="13" r="4"/>
                </svg>
                <div className="text-sm font-medium">No photo taken yet</div>
              </>
            )}
          </div>

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handlePhotoChange}
          />

          <button
            onClick={() => fileRef.current?.click()}
            className="w-full text-white font-bold rounded-xl py-4 shadow-lg flex items-center justify-center gap-2 text-lg active:scale-95 transition-transform"
            style={{ background: 'linear-gradient(135deg, #3b82f6, #2563eb)', boxShadow: '0 8px 20px -4px rgba(37,99,235,0.4)' }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
              <circle cx="12" cy="13" r="4"/>
            </svg>
            {photoUrl ? 'Retake Photo' : 'Take Live Photo'}
          </button>
        </div>

        {/* GPS / EXIF data card */}
        <div
          className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 transition-opacity duration-300"
          style={{ opacity: photoUrl ? 1 : 0.45 }}
        >
          <h3 className="font-bold mb-4 flex items-center gap-2 text-[15px]">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
              <circle cx="12" cy="10" r="3"/>
            </svg>
            GPS Location
          </h3>

          <div className="space-y-3">
            {/* Timestamp */}
            <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
              <div className="text-xs text-slate-500 mb-1">Timestamp</div>
              <div className="font-medium font-mono text-sm">
                {gpsData
                  ? gpsData.timestamp.toLocaleString('en-IN')
                  : '--:--:--'}
              </div>
            </div>

            {/* Lat / Lng */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                <div className="text-xs text-slate-500 mb-1">Latitude</div>
                <div className="font-medium font-mono text-sm">
                  {gpsData ? `${gpsData.lat.toFixed(5)} N` : '--.-----'}
                </div>
              </div>
              <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                <div className="text-xs text-slate-500 mb-1">Longitude</div>
                <div className="font-medium font-mono text-sm">
                  {gpsData ? `${gpsData.lng.toFixed(5)} E` : '--.-----'}
                </div>
              </div>
            </div>

            {/* Accuracy */}
            {gpsData && (
              <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                <div className="text-xs text-slate-500 mb-1">GPS Accuracy</div>
                <div className="font-medium font-mono text-sm">± {gpsData.accuracy} m</div>
              </div>
            )}

            {/* Zone indicator */}
            <div className="bg-slate-50 p-3 rounded-lg border border-slate-100 flex items-center gap-2">
              {gpsState === 'loading' ? (
                <>
                  <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                  <div className="text-sm font-medium text-blue-600">Fetching GPS…</div>
                </>
              ) : gpsState === 'error' ? (
                <>
                  <div className="w-2 h-2 rounded-full bg-red-500" />
                  <div className="text-sm font-medium text-red-600">{gpsError}</div>
                </>
              ) : gpsData ? (
                <>
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{ background: gpsData.isOnSite ? '#16A34A' : '#DC2626' }}
                  />
                  <div
                    className="text-sm font-medium"
                    style={{ color: gpsData.isOnSite ? '#15803D' : '#DC2626' }}
                  >
                    {gpsData.statusLabel}
                  </div>
                </>
              ) : (
                <>
                  <div className="w-2 h-2 rounded-full bg-slate-300" />
                  <div className="text-sm font-medium text-slate-400">Waiting for photo…</div>
                </>
              )}
            </div>

            {/* Manual GPS refresh */}
            {photoUrl && gpsState !== 'loading' && (
              <button
                onClick={fetchGps}
                className="text-xs text-blue-600 font-semibold hover:underline"
              >
                ↺ Refresh GPS location
              </button>
            )}
          </div>
        </div>

        {/* Optional note */}
        <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
          <label className="block text-xs font-bold text-slate-600 mb-2 uppercase tracking-wide">
            Note (optional)
          </label>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            rows={2}
            className="w-full p-3 text-sm border border-slate-200 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-blue-300"
            placeholder="Any observations for this shift…"
          />
        </div>

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="w-full font-bold rounded-xl py-4 text-lg transition-all"
          style={{
            background: canSubmit ? '#10B981' : '#94A3B8',
            color: '#fff',
            cursor: canSubmit ? 'pointer' : 'not-allowed',
            boxShadow: canSubmit ? '0 8px 20px -4px rgba(16,185,129,0.4)' : 'none',
          }}
        >
          {submitState === 'submitting' ? 'Submitting…' : 'Submit Shift Report'}
        </button>

        {!photoUrl && (
          <p className="text-center text-xs text-slate-400">
            Take a live photo to enable submission.
          </p>
        )}
        {photoUrl && gpsState === 'idle' && (
          <p className="text-center text-xs text-slate-400">
            Fetching GPS — please wait…
          </p>
        )}

      </main>
    </div>
  );
}
