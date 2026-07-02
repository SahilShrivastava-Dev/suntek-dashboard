import { describe, it, expect } from 'vitest';
import { profileCanAccess, roleToProfile, initialsFrom, type MockProfile, type RoleRow } from './profiles';

// Synthetic profiles (the role catalog is now DB-driven; tests use fixtures).
function mk(allowed: string[], overrides: Partial<MockProfile> = {}): MockProfile {
  return {
    id: 'test',
    name: 'Test User',
    role: 'L2',
    roleLabel: 'Test',
    roleDescription: '',
    initials: 'TU',
    avatarFrom: 'from-slate-300',
    avatarTo: 'to-slate-500',
    homeRoute: '/dashboard',
    allowedDashboardRoutes: allowed,
    standaloneOnly: false,
    capabilities: [],
    ...overrides,
  };
}

describe('profileCanAccess', () => {
  it('grants access to any route via the wildcard', () => {
    const admin = mk(['*']);
    expect(profileCanAccess(admin, '/dashboard')).toBe(true);
    expect(profileCanAccess(admin, '/dashboard/purchase/marine')).toBe(true);
    expect(profileCanAccess(admin, '/dashboard/anything-new')).toBe(true);
  });

  it('uses EXACT matching — a parent route does NOT grant child routes', () => {
    // Has '/dashboard' but must NOT reach the L1 entry terminals.
    const p = mk(['/dashboard', '/dashboard/stock']);
    expect(profileCanAccess(p, '/dashboard')).toBe(true);
    expect(profileCanAccess(p, '/dashboard/night-entry')).toBe(false);
    expect(profileCanAccess(p, '/dashboard/batch-entry')).toBe(false);
  });

  it('allows explicitly listed routes and denies unlisted ones', () => {
    const p = mk(['/dashboard/stock', '/dashboard/purchase/storereq']);
    expect(profileCanAccess(p, '/dashboard/stock')).toBe(true);
    expect(profileCanAccess(p, '/dashboard/sales')).toBe(false);
    expect(profileCanAccess(p, '/dashboard/purchase/marine')).toBe(false);
  });

  it('scopes a single-purpose role to just its entry route', () => {
    const night = mk(['/dashboard/night-entry']);
    expect(profileCanAccess(night, '/dashboard/night-entry')).toBe(true);
    expect(profileCanAccess(night, '/dashboard')).toBe(false);
    expect(profileCanAccess(night, '/dashboard/stock')).toBe(false);
  });
});

describe('initialsFrom', () => {
  it('takes first + last initial for multi-word names', () => {
    expect(initialsFrom('Sagar Nenwani')).toBe('SN');
    expect(initialsFrom('Anil Kumar Gupta')).toBe('AG');
  });
  it('takes the first two letters for single-word names', () => {
    expect(initialsFrom('Anshul')).toBe('AN');
  });
  it('handles empty input', () => {
    expect(initialsFrom('')).toBe('?');
  });
});

describe('roleToProfile', () => {
  const role: RoleRow = {
    id: 'unit_head',
    label: 'Unit Head',
    level: 'L3',
    description: 'Ops oversight',
    home_route: '/dashboard',
    allowed_routes: ['/dashboard', '/dashboard/stock'],
    standalone_only: false,
    is_admin: false,
    is_system: false,
    capabilities: [],
    avatar_from: 'from-blue-400',
    avatar_to: 'to-blue-600',
    sort_order: 2,
  };

  it('maps a role row to a MockProfile and derives initials from the overridden name', () => {
    const p = roleToProfile(role, { name: 'Vijay Ji', id: 'db_1', baseRoleId: 'unit_head' });
    expect(p.id).toBe('db_1');
    expect(p.role).toBe('L3');
    expect(p.roleLabel).toBe('Unit Head');
    expect(p.roleDescription).toBe('Ops oversight');
    expect(p.allowedDashboardRoutes).toEqual(['/dashboard', '/dashboard/stock']);
    expect(p.baseRoleId).toBe('unit_head');
    expect(p.initials).toBe('VJ');
    expect(profileCanAccess(p, '/dashboard/stock')).toBe(true);
    expect(profileCanAccess(p, '/dashboard/sales')).toBe(false);
  });
});
