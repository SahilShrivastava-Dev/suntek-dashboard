/**
 * Cloudinary upload utility for Night Manager shift check-ins.
 *
 * Uses unsigned upload (no server-side secret needed) via an upload preset.
 *
 * Setup required in Cloudinary dashboard:
 *   Settings → Upload → Upload Presets → Add preset
 *   Set "Signing mode" to Unsigned, name it "suntek_checkins"
 *
 * Env vars required in .env.local:
 *   VITE_CLOUDINARY_CLOUD_NAME=your_cloud_name
 *   VITE_CLOUDINARY_UPLOAD_PRESET=suntek_checkins
 */

export interface CloudinaryUploadResult {
  secure_url: string;     // HTTPS URL to the uploaded image
  public_id: string;      // Cloudinary asset ID (path within folder)
  asset_id: string;
  created_at: string;
  bytes: number;
  width: number;
  height: number;
  format: string;
}

export interface CheckinPhotoMeta {
  plantName: string;
  lat: number;
  lng: number;
  isOnSite: boolean;
  workerInitials?: string;
  /** Callback fired as upload progresses (0–100) */
  onProgress?: (pct: number) => void;
}

/**
 * Upload a captured JPEG blob to Cloudinary.
 *
 * - Stores under  suntek/night-checkins/{YYYY-MM-DD}/
 * - Tags with:   plant:{name}, date:{YYYY-MM-DD}, on_site | out_of_zone
 * - Attaches GPS context as custom metadata (queryable in Cloudinary)
 *
 * Simulates upload progress because the Fetch API does not expose
 * XHR-style progress events.
 */
export interface MaintenancePhotoMeta {
  ticketId: string;
  plantName: string;
  photoType: 'completion' | 'defective' | 'bill';
  onProgress?: (pct: number) => void;
}

export async function uploadMaintenancePhoto(
  blob: Blob,
  meta: MaintenancePhotoMeta
): Promise<CloudinaryUploadResult> {
  const cloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME as string | undefined;
  const uploadPreset = (import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET as string | undefined) ?? 'suntek_checkins';

  if (!cloudName || cloudName === 'your_cloud_name_here') {
    throw new Error('VITE_CLOUDINARY_CLOUD_NAME is not set. Add it to .env.local and restart.');
  }

  let progressTimer: ReturnType<typeof setInterval> | null = null;
  let fakeProgress = 0;
  if (meta.onProgress) {
    meta.onProgress(0);
    progressTimer = setInterval(() => {
      fakeProgress = Math.min(fakeProgress + Math.random() * 12 + 3, 88);
      meta.onProgress?.(Math.round(fakeProgress));
    }, 250);
  }

  try {
    const today = new Date().toISOString().split('T')[0];
    const timestamp = Date.now();
    const filename = `maint_${meta.photoType}_${timestamp}.jpg`;
    const formData = new FormData();
    formData.append('file', blob, filename);
    formData.append('upload_preset', uploadPreset);
    formData.append('folder', `suntek/maintenance/${meta.ticketId}`);
    formData.append('tags', [`type:${meta.photoType}`, `plant:${meta.plantName}`, `date:${today}`].join(','));
    const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error?.message ?? `Upload failed (HTTP ${res.status})`);
    meta.onProgress?.(100);
    return data as CloudinaryUploadResult;
  } finally {
    if (progressTimer) clearInterval(progressTimer);
  }
}

export async function uploadCheckinPhoto(
  blob: Blob,
  meta: CheckinPhotoMeta
): Promise<CloudinaryUploadResult> {
  const cloudName   = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME as string | undefined;
  const uploadPreset = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET as string | undefined
    ?? 'suntek_checkins';

  if (!cloudName || cloudName === 'your_cloud_name_here') {
    throw new Error(
      'VITE_CLOUDINARY_CLOUD_NAME is not set. ' +
      'Add it to .env.local and restart the dev server.'
    );
  }

  // ── Simulated progress (0 → ~88% while uploading) ─────────────────────────
  let progressTimer: ReturnType<typeof setInterval> | null = null;
  let fakeProgress = 0;

  if (meta.onProgress) {
    meta.onProgress(0);
    progressTimer = setInterval(() => {
      fakeProgress = Math.min(fakeProgress + Math.random() * 12 + 3, 88);
      meta.onProgress?.(Math.round(fakeProgress));
    }, 250);
  }

  try {
    const today     = new Date().toISOString().split('T')[0];          // YYYY-MM-DD
    const timestamp = Date.now();
    const safePlant = meta.plantName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename  = `checkin_${safePlant}_${timestamp}.jpg`;

    const formData = new FormData();
    formData.append('file',           blob, filename);
    formData.append('upload_preset',  uploadPreset);
    formData.append('folder',         `suntek/night-checkins/${today}`);
    formData.append('tags', [
      `plant:${meta.plantName}`,
      `date:${today}`,
      meta.isOnSite ? 'on_site' : 'out_of_zone',
      ...(meta.workerInitials ? [`worker:${meta.workerInitials}`] : []),
    ].join(','));
    // Cloudinary contextual metadata — visible in asset detail view
    formData.append('context', [
      `lat=${meta.lat.toFixed(6)}`,
      `lng=${meta.lng.toFixed(6)}`,
      `is_on_site=${meta.isOnSite}`,
      `plant=${meta.plantName}`,
      `captured_at=${new Date().toISOString()}`,
    ].join('|'));

    const res = await fetch(
      `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
      { method: 'POST', body: formData }
    );

    const data = await res.json();

    if (!res.ok || data.error) {
      throw new Error(data.error?.message ?? `Cloudinary upload failed (HTTP ${res.status})`);
    }

    meta.onProgress?.(100);
    return data as CloudinaryUploadResult;
  } finally {
    if (progressTimer) clearInterval(progressTimer);
  }
}
