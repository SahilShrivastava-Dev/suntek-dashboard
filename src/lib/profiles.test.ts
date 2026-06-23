import { describe, it, expect } from 'vitest';
import { MOCK_PROFILES, DEFAULT_PROFILE, profileCanAccess, type MockProfile } from './profiles';

function profile(id: string): MockProfile {
  const p = MOCK_PROFILES.find((x) => x.id === id);
  if (!p) throw new Error(`profile ${id} not found`);
  return p;
}

describe('profileCanAccess', () => {
  it('grants admin access to any route via wildcard', () => {
    const admin = profile('admin');
    expect(profileCanAccess(admin, '/dashboard')).toBe(true);
    expect(profileCanAccess(admin, '/dashboard/purchase/marine')).toBe(true);
    expect(profileCanAccess(admin, '/dashboard/anything-new')).toBe(true);
  });

  it('uses EXACT matching — a parent route does NOT grant child routes', () => {
    // Unit Head has '/dashboard' but must NOT reach the L1 entry terminals.
    const unitHead = profile('unit_head');
    expect(profileCanAccess(unitHead, '/dashboard')).toBe(true);
    expect(profileCanAccess(unitHead, '/dashboard/night-entry')).toBe(false);
    expect(profileCanAccess(unitHead, '/dashboard/batch-entry')).toBe(false);
  });

  it('allows explicitly listed routes and denies unlisted ones', () => {
    const unitHead = profile('unit_head');
    expect(profileCanAccess(unitHead, '/dashboard/stock')).toBe(true);
    expect(profileCanAccess(unitHead, '/dashboard/sales')).toBe(false); // sales team only
    expect(profileCanAccess(unitHead, '/dashboard/purchase/marine')).toBe(false); // finance-only
  });

  it('scopes a single-purpose L1 role to just its entry route', () => {
    const night = profile('night_manager');
    expect(profileCanAccess(night, '/dashboard/night-entry')).toBe(true);
    expect(profileCanAccess(night, '/dashboard')).toBe(false);
    expect(profileCanAccess(night, '/dashboard/stock')).toBe(false);
  });

  it('keeps the two accountant roles aligned on their financial route set', () => {
    const delhi = profile('accountant_delhi');
    const other = profile('accountant_other');
    for (const route of ['/dashboard/sales', '/dashboard/customers', '/dashboard/purchase/marine']) {
      expect(profileCanAccess(delhi, route)).toBe(true);
      expect(profileCanAccess(other, route)).toBe(true);
    }
    // Neither accountant can reach production batch status.
    expect(profileCanAccess(delhi, '/dashboard/batches')).toBe(false);
    expect(profileCanAccess(other, '/dashboard/batches')).toBe(false);
  });

  it('defaults to the admin profile', () => {
    expect(DEFAULT_PROFILE.id).toBe('admin');
  });
});
