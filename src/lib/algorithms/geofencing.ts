/**
 * Geofencing algorithm for Night Manager check-in.
 * Uses the Haversine formula to compute great-circle distance between two GPS coordinates.
 */

const EARTH_RADIUS_M = 6_371_000; // Earth radius in meters

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Calculate the distance in metres between two GPS coordinates.
 * Uses the Haversine formula.
 */
export function haversineDistance(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}

export interface GeofenceResult {
  distanceM: number;
  isOnSite: boolean;
  status: 'on_site' | 'out_of_zone';
  /** Allowed radius (m) — for building a localized status label in the UI. */
  radiusM: number;
  statusLabel: string;
}

/**
 * Check whether an employee's GPS coordinate is within the plant's geofence.
 *
 * @param employeeLat  - Employee's latitude (from mobile GPS)
 * @param employeeLng  - Employee's longitude (from mobile GPS)
 * @param plantLat     - Plant center latitude
 * @param plantLng     - Plant center longitude
 * @param radiusM      - Allowed radius in metres (e.g. 200m)
 */
export function validateGeofence(
  employeeLat: number,
  employeeLng: number,
  plantLat: number,
  plantLng: number,
  radiusM: number
): GeofenceResult {
  const distanceM = haversineDistance(employeeLat, employeeLng, plantLat, plantLng);
  const isOnSite = distanceM <= radiusM;

  return {
    distanceM: Math.round(distanceM),
    isOnSite,
    status: isOnSite ? 'on_site' : 'out_of_zone',
    radiusM,
    statusLabel: isOnSite
      ? `Within Factory Geofence (${Math.round(distanceM)}m from centre)`
      : `Outside Zone — ${Math.round(distanceM)}m from centre (limit: ${radiusM}m)`,
  };
}
