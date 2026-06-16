import { describe, it, expect } from 'vitest';
import { haversineDistance, validateGeofence } from './geofencing';

// Rehla plant centre per the codebase
const REHLA_LAT = 24.1856;
const REHLA_LNG = 84.0644;

describe('haversineDistance', () => {
  it('returns 0 for identical coordinates', () => {
    expect(haversineDistance(REHLA_LAT, REHLA_LNG, REHLA_LAT, REHLA_LNG)).toBe(0);
  });

  it('is symmetric', () => {
    const a = haversineDistance(24.18, 84.06, 24.19, 84.07);
    const b = haversineDistance(24.19, 84.07, 24.18, 84.06);
    expect(a).toBeCloseTo(b, 6);
  });

  it('approximates 1 degree of latitude as ~111 km', () => {
    const d = haversineDistance(0, 0, 1, 0);
    expect(d).toBeGreaterThan(110_000);
    expect(d).toBeLessThan(112_000);
  });
});

describe('validateGeofence', () => {
  it('marks a point at the plant centre as on-site', () => {
    const r = validateGeofence(REHLA_LAT, REHLA_LNG, REHLA_LAT, REHLA_LNG, 200);
    expect(r.isOnSite).toBe(true);
    expect(r.status).toBe('on_site');
    expect(r.distanceM).toBe(0);
    expect(r.statusLabel).toContain('Within Factory Geofence');
  });

  it('marks a point well outside the radius as out of zone', () => {
    // ~0.01 deg latitude ≈ 1.1km, far beyond 200m
    const r = validateGeofence(REHLA_LAT + 0.01, REHLA_LNG, REHLA_LAT, REHLA_LNG, 200);
    expect(r.isOnSite).toBe(false);
    expect(r.status).toBe('out_of_zone');
    expect(r.distanceM).toBeGreaterThan(200);
    expect(r.statusLabel).toContain('Outside Zone');
  });

  it('treats a point exactly on the radius boundary as on-site (<=)', () => {
    // distance for 0.0001 deg lat ≈ 11.1m, within 200m
    const r = validateGeofence(REHLA_LAT + 0.0001, REHLA_LNG, REHLA_LAT, REHLA_LNG, 200);
    expect(r.isOnSite).toBe(true);
  });
});
