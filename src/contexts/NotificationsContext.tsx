import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { insertRows, updateRows } from '../lib/db';
import { useRoleContext } from './RoleContext';

export interface AppNotification {
  id: string;
  target_roles: string[];
  title: string;
  body: string | null;
  type: 'info' | 'warning' | 'urgent';
  route: string | null;
  actor_name: string | null;
  actor_role: string | null;
  created_at: string;
  read_by: string[];
}

interface NotificationsContextValue {
  notifications: AppNotification[];
  unreadCount: number;
  markRead: (id: string) => void;
  markAllRead: () => void;
  addNotification: (n: Omit<AppNotification, 'id' | 'created_at' | 'read_by'>) => Promise<void>;
  tableReady: boolean;
}

const NotificationsContext = createContext<NotificationsContextValue>({
  notifications: [],
  unreadCount: 0,
  markRead: () => {},
  markAllRead: () => {},
  addNotification: async () => {},
  tableReady: false,
});

export function useNotifications() {
  return useContext(NotificationsContext);
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
      setNotifications(data || []);
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
        if (n.target_roles?.includes(roleId)) {
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

  async function addNotification(n: Omit<AppNotification, 'id' | 'created_at' | 'read_by'>) {
    if (!tableReady) return;
    await insertRows('notifications', {
      ...n,
      read_by: [],
    }).then(() => {}, () => {});
  }

  return (
    <NotificationsContext.Provider value={{ notifications, unreadCount, markRead, markAllRead, addNotification, tableReady }}>
      {children}
    </NotificationsContext.Provider>
  );
}
