import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { insertRows, updateRows } from '../lib/db';
import { useRoleContext } from './RoleContext';
import { usePlantScope } from './PlantScopeContext';

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
  /**
   * 'personal' = an @-mention / CC to specific people (matched ONLY by personal
   * id, so it never leaks to others who share a role). 'broadcast' (default) =
   * a role/audience announcement (matched by role id). Omit on personal
   * producers? No — personal producers MUST set 'personal'; everything else
   * defaults to 'broadcast' at the DB.
   */
  scope?: 'personal' | 'broadcast';
  /**
   * The plant/unit this notification concerns. NULL = broadcast (delivered by
   * role only). When set, delivery is additionally gated by the recipient's data
   * scope — a "unit head at plant X" tag only reaches in-scope / global users.
   */
  plant_id?: string | null;
  unit_id?: string | null;
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
  const { activeProfile, activeIdentityIds, activePersonId, activeAccountFloor } = useRoleContext();
  const { inScope, isGlobal } = usePlantScope();
  // Per-person bookkeeping key (read / cleared / unread). The PERSONAL id, so
  // two people who share a role keep independent read & cleared state.
  const selfKey = activePersonId || activeProfile?.id || 'admin';
  const personId = activePersonId || selfKey;
  // Every id this person answers to (personal id + role id) — used to match
  // role BROADCASTS. Stable string key for effect deps.
  const identityIds = activeIdentityIds?.length ? activeIdentityIds : [selfKey];
  const identityKey = identityIds.join(',');
  // Hide notifications created before this person's account existed.
  const floor = activeAccountFloor;

  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [tableReady, setTableReady] = useState(false);

  // Does this notification belong to the active person?
  //  • 'personal' (an @-mention / CC) → matched STRICTLY by personal id, so it
  //    never leaks to others who merely share a role.
  //  • 'broadcast' / legacy → matched by any role/identity id.
  const isForMe = useCallback((n: AppNotification): boolean => {
    if (!n.target_roles) return false;
    // Plant/unit gate: a plant-tagged notification only reaches users whose data
    // scope includes that plant (global users always qualify; NULL = broadcast).
    if (n.plant_id && !isGlobal && !inScope(n.plant_id, n.unit_id)) return false;
    if (n.scope === 'personal') return n.target_roles.includes(personId);
    const idSet = new Set(identityIds);
    return n.target_roles.some((id) => idSet.has(id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identityKey, personId, isGlobal, inScope]);

  // Load notifications addressed to this person (personal tags + role broadcasts),
  // newer than their account floor.
  const loadNotifications = useCallback(async () => {
    try {
      let query = supabase
        .from('notifications')
        .select('*')
        .overlaps('target_roles', identityIds);
      if (floor) query = query.gte('created_at', floor);
      const { data, error } = await query
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
      // Apply the personal/broadcast scope filter + hide cleared.
      const cleared = getClearedSet(selfKey);
      setNotifications((data || []).filter((n) => isForMe(n) && !cleared.has(n.id) && !n.cleared_by?.includes(selfKey)));
    } catch {
      setTableReady(false);
    }
    // identityKey is the stable string form of identityIds (the query input);
    // personId/floor define the filter, selfKey the cleared set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identityKey, personId, selfKey, floor, isForMe]);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  // Supabase real-time subscription for new notifications. A tag fires here the
  // moment it's inserted — same scope-aware match as the load.
  useEffect(() => {
    if (!tableReady) return;
    const channel = supabase
      .channel(`notifications:${selfKey}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
      }, (payload) => {
        const n = payload.new as AppNotification;
        if (isForMe(n) && (!floor || n.created_at >= floor) && !getClearedSet(selfKey).has(n.id)) {
          setNotifications(prev => (prev.some((x) => x.id === n.id) ? prev : [n, ...prev]));
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [identityKey, personId, selfKey, floor, tableReady, isForMe]);

  const unreadCount = notifications.filter(n => !n.read_by?.includes(selfKey)).length;

  function markRead(id: string) {
    setNotifications(prev =>
      prev.map(n => n.id === id && !n.read_by.includes(selfKey)
        ? { ...n, read_by: [...n.read_by, selfKey] }
        : n
      )
    );
    // Persist read state to DB (non-blocking) — optimistic local state is primary
    supabase.from('notifications')
      .select('read_by').eq('id', id).limit(1).returns<{ read_by: string[] | null }[]>()
      .then(({ data }) => {
        const row = data?.[0];
        if (row && !row.read_by?.includes(selfKey)) {
          updateRows('notifications', { read_by: [...(row.read_by || []), selfKey] })
            .eq('id', id)
            .then(() => {}, () => {});
        }
      }, () => {});
  }

  function markAllRead() {
    setNotifications(prev =>
      prev.map(n => n.read_by.includes(selfKey) ? n : { ...n, read_by: [...n.read_by, selfKey] })
    );
    // Optimistic — don't wait for DB
  }

  function clearAll() {
    const current = notifications;
    // Persistent per-profile pointer (survives reload, no DB delete needed).
    addCleared(selfKey, current.map((n) => n.id));
    setNotifications([]); // optimistic — instant for this profile
    // Also write the DB marker when the column exists (best-effort, cross-device).
    current.forEach((n) => {
      if (n.cleared_by?.includes(selfKey)) return;
      updateRows('notifications', { cleared_by: [...(n.cleared_by || []), selfKey] })
        .eq('id', n.id)
        .then(() => {}, () => {});
    });
  }

  async function addNotification(n: Omit<AppNotification, 'id' | 'created_at' | 'read_by'>): Promise<boolean> {
    if (!tableReady) return false;
    let ok = false;
    await insertRows('notifications', { ...n, read_by: [] }).then(() => { ok = true; }, () => { ok = false; });
    // Fallback for a DB that hasn't run 24_notification_scope.sql / 27_plant_unit_
    // scoping.sql yet: retry without scope + plant/unit columns so the
    // notification still sends (degrades to a plain role broadcast).
    if (!ok && (n.scope || n.plant_id || n.unit_id)) {
      const { scope, plant_id, unit_id, ...rest } = n;
      void scope; void plant_id; void unit_id;
      await insertRows('notifications', { ...rest, read_by: [] }).then(() => { ok = true; }, () => {});
    }
    return ok;
  }

  return (
    <NotificationsContext.Provider value={{ notifications, unreadCount, markRead, markAllRead, clearAll, addNotification, tableReady }}>
      {children}
    </NotificationsContext.Provider>
  );
}
