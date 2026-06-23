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
  addNotification: (n: Omit<AppNotification, 'id' | 'created_at' | 'read_by'>) => Promise<void>;
  tableReady: boolean;
}

const NotificationsContext = createContext<NotificationsContextValue>({
  notifications: [],
  unreadCount: 0,
  markRead: () => {},
  markAllRead: () => {},
  clearAll: () => {},
  addNotification: async () => {},
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
  const { activeProfile } = useRoleContext();
  const roleId = activeProfile?.id ?? 'admin';

  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [tableReady, setTableReady] = useState(false);

  // Load notifications for the current role from Supabase
  const loadNotifications = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .contains('target_roles', [roleId])
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
  }, [roleId]);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  // Supabase real-time subscription for new notifications
  useEffect(() => {
    if (!tableReady) return;
    const channel = supabase
      .channel(`notifications:${roleId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
      }, (payload) => {
        const n = payload.new as AppNotification;
        if (n.target_roles?.includes(roleId) && !getClearedSet(roleId).has(n.id)) {
          setNotifications(prev => [n, ...prev]);
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [roleId, tableReady]);

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

  async function addNotification(n: Omit<AppNotification, 'id' | 'created_at' | 'read_by'>) {
    if (!tableReady) return;
    await insertRows('notifications', {
      ...n,
      read_by: [],
    }).then(() => {}, () => {});
  }

  return (
    <NotificationsContext.Provider value={{ notifications, unreadCount, markRead, markAllRead, clearAll, addNotification, tableReady }}>
      {children}
    </NotificationsContext.Provider>
  );
}
