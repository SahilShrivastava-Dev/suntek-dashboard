import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { insertRows, updateRows } from '../lib/db';
import { useRoleContext } from './RoleContext';

export interface AppNotification {
  id: string;
  target_roles: string[];
  title: string;
  body: string | null;
  type: 'info' | 'warning' | 'urgent' | 'critical';
  route: string | null;
  actor_name: string | null;
  actor_role: string | null;
  created_at: string;
  read_by: string[];
  cleared_by?: string[];
}

interface NotificationsContextValue {
  notifications: AppNotification[];
  unreadCount: number;
  markRead: (id: string) => void;
  markAllRead: () => void;
  /** Remove every notification from THIS profile's view (read or unread). */
  clearAll: () => void;
  /** Insert a notification; resolves true when the row was created (delivered). */
  addNotification: (n: Omit<AppNotification, 'id' | 'created_at' | 'read_by'>) => Promise<boolean>;
  tableReady: boolean;
}

const NotificationsContext = createContext<NotificationsContextValue>({
  notifications: [],
  unreadCount: 0,
  markRead: () => {},
  markAllRead: () => {},
  clearAll: () => {},
  addNotification: async () => false,
  tableReady: false,
});

export function useNotifications() {
  return useContext(NotificationsContext);
}

// ── Per-profile "cleared" pointer (localStorage) ──────────────────────────────
// "Clear all" must persist across reloads WITHOUT deleting the DB row (the
// record of who-was-notified stays intact). We keep a per-profile set of
// cleared notification ids locally and filter them out on load.
const clearedKey = (roleId: string) => `suntek.clearedNotifs.${roleId}`;
function getClearedSet(roleId: string): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(clearedKey(roleId)) || '[]')); }
  catch { return new Set(); }
}
function addCleared(roleId: string, ids: string[]) {
  try {
    const set = getClearedSet(roleId);
    ids.forEach((id) => set.add(id));
    localStorage.setItem(clearedKey(roleId), JSON.stringify([...set].slice(-2000)));
  } catch { /* storage unavailable — clear is session-only */ }
}

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const { activeProfile, activeIdentityIds } = useRoleContext();
  // The id used for per-person bookkeeping (read/cleared pointers).
  const roleId = activeProfile?.id ?? 'admin';
  // Every id this person answers to — they own a notification addressed to ANY
  // of these (their role id, their personal db id, etc.). Stable string key for
  // effect deps. Falls back to the primary id if the set hasn't resolved yet.
  const identityIds = activeIdentityIds?.length ? activeIdentityIds : [roleId];
  const identityKey = identityIds.join(',');

  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [tableReady, setTableReady] = useState(false);

  // Load notifications addressed to any of this person's identities.
  const loadNotifications = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .overlaps('target_roles', identityIds)
        .order('created_at', { ascending: false })
        .limit(50)
        .returns<AppNotification[]>();
      if (error) {
        // Table doesn't exist yet — degrade gracefully
        if (error.code === '42P01' || error.message?.includes('relation') || error.message?.includes('notifications')) {
          setTableReady(false);
          return;
        }
      }
      setTableReady(true);
      // Hide notifications this profile has cleared (local pointer + DB marker).
      const cleared = getClearedSet(roleId);
      setNotifications((data || []).filter((n) => !cleared.has(n.id) && !n.cleared_by?.includes(roleId)));
    } catch {
      setTableReady(false);
    }
    // identityKey is the stable string form of identityIds (every id we query
    // for); roleId drives the cleared filter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identityKey, roleId]);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  // Supabase real-time subscription for new notifications. A tag fires here the
  // moment it's inserted — match on ANY of this person's identities.
  useEffect(() => {
    if (!tableReady) return;
    const idSet = new Set(identityIds);
    const channel = supabase
      .channel(`notifications:${roleId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
      }, (payload) => {
        const n = payload.new as AppNotification;
        if (n.target_roles?.some((id) => idSet.has(id)) && !getClearedSet(roleId).has(n.id)) {
          setNotifications(prev => (prev.some((x) => x.id === n.id) ? prev : [n, ...prev]));
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identityKey, roleId, tableReady]);

  const unreadCount = notifications.filter(n => !n.read_by?.includes(roleId)).length;

  function markRead(id: string) {
    setNotifications(prev =>
      prev.map(n => n.id === id && !n.read_by.includes(roleId)
        ? { ...n, read_by: [...n.read_by, roleId] }
        : n
      )
    );
    // Persist read state to DB (non-blocking) — optimistic local state is primary
    supabase.from('notifications')
      .select('read_by').eq('id', id).limit(1).returns<{ read_by: string[] | null }[]>()
      .then(({ data }) => {
        const row = data?.[0];
        if (row && !row.read_by?.includes(roleId)) {
          updateRows('notifications', { read_by: [...(row.read_by || []), roleId] })
            .eq('id', id)
            .then(() => {}, () => {});
        }
      }, () => {});
  }

  function markAllRead() {
    setNotifications(prev =>
      prev.map(n => n.read_by.includes(roleId) ? n : { ...n, read_by: [...n.read_by, roleId] })
    );
    // Optimistic — don't wait for DB
  }

  function clearAll() {
    const current = notifications;
    // Persistent per-profile pointer (survives reload, no DB delete needed).
    addCleared(roleId, current.map((n) => n.id));
    setNotifications([]); // optimistic — instant for this profile
    // Also write the DB marker when the column exists (best-effort, cross-device).
    current.forEach((n) => {
      if (n.cleared_by?.includes(roleId)) return;
      updateRows('notifications', { cleared_by: [...(n.cleared_by || []), roleId] })
        .eq('id', n.id)
        .then(() => {}, () => {});
    });
  }

  async function addNotification(n: Omit<AppNotification, 'id' | 'created_at' | 'read_by'>): Promise<boolean> {
    if (!tableReady) return false;
    let ok = false;
    await insertRows('notifications', {
      ...n,
      read_by: [],
    }).then(() => { ok = true; }, () => { ok = false; });
    return ok;
  }

  return (
    <NotificationsContext.Provider value={{ notifications, unreadCount, markRead, markAllRead, clearAll, addNotification, tableReady }}>
      {children}
    </NotificationsContext.Provider>
  );
}
