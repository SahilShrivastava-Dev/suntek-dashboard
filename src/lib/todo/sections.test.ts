import { describe, it, expect } from 'vitest';
import { buildUrgentItems } from './sections';
import type { AppNotification } from '../../contexts/NotificationsContext';

function notif(over: Partial<AppNotification>): AppNotification {
  return {
    id: over.id ?? 'n1',
    target_roles: ['admin'],
    title: 'Maintenance ticket raised: GLC3',
    body: null,
    type: 'urgent',
    route: '/dashboard/purchase/maint?ticket=abc-123',
    actor_name: 'Sagar Nenwani',
    actor_role: 'admin',
    created_at: '2026-07-23T10:00:00Z',
    read_by: [],
    ...over,
  };
}

describe('buildUrgentItems', () => {
  it('keeps urgent and critical notifications, drops info/warning', () => {
    const items = buildUrgentItems([
      notif({ id: 'a', type: 'urgent' }),
      notif({ id: 'b', type: 'critical' }),
      notif({ id: 'c', type: 'info' }),
      notif({ id: 'd', type: 'warning' }),
    ]);
    expect(items.map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('excludes notifications whose linked workflow is completed (closed ticket)', () => {
    const completed = new Set(['closed-1']);
    const items = buildUrgentItems(
      [
        notif({ id: 'open', route: '/dashboard/purchase/maint?ticket=open-1' }),
        notif({ id: 'closed', route: '/dashboard/purchase/maint?ticket=closed-1' }),
      ],
      (n) => !!n.route && completed.has(new URLSearchParams(n.route.split('?')[1] ?? '').get('ticket') ?? ''),
    );
    expect(items.map((i) => i.id)).toEqual(['open']);
  });

  it('re-includes a reopened ticket (predicate no longer marks it completed)', () => {
    const rows = [notif({ id: 'x', route: '/dashboard/purchase/maint?ticket=t1' })];
    expect(buildUrgentItems(rows, () => true)).toHaveLength(0);
    expect(buildUrgentItems(rows, () => false)).toHaveLength(1);
  });

  it('defaults to including everything when no predicate is given', () => {
    expect(buildUrgentItems([notif({})])).toHaveLength(1);
  });

  // A maintenance notification whose route lost its `?ticket=` id is a dead
  // link: it opens the module's default (Periodic) tab and can never be matched
  // against the closed-ticket lookup, so it would sit in To-Do forever.
  it('drops dead maintenance links but keeps id-less alerts from other modules', () => {
    const isStale = (n: AppNotification) => {
      const route = n.route || '';
      if (!route.startsWith('/dashboard/purchase/maint')) return false;
      return !new URLSearchParams(route.split('?')[1] ?? '').get('ticket');
    };
    const items = buildUrgentItems(
      [
        notif({ id: 'dead', route: '/dashboard/purchase/maint' }),
        notif({ id: 'live', route: '/dashboard/purchase/maint?ticket=t1' }),
        notif({ id: 'blacklist', route: '/dashboard/blacklist' }),
      ],
      isStale,
    );
    expect(items.map((i) => i.id)).toEqual(['live', 'blacklist']);
  });
});
