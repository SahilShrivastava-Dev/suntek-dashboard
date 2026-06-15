import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export interface BlacklistEntry {
  id: string;
  type: 'person' | 'vehicle' | 'vendor' | 'other';
  name: string;
  identifier: string | null;
  reason: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  notes: string | null;
  reference_no: string | null;
  added_by: string;
  added_by_role: string | null;
  is_active: boolean;
  resolved_at: string | null;
  resolved_by: string | null;
  resolved_reason: string | null;
  created_at: string;
}

interface BlacklistContextValue {
  entries: BlacklistEntry[];
  activeEntries: BlacklistEntry[];
  /** Check if a person name is on the active blacklist */
  isPersonBlacklisted: (name: string) => BlacklistEntry | null;
  /** Check if any identifier (vehicle no., etc.) is on the active blacklist */
  isIdentifierBlacklisted: (identifier: string) => BlacklistEntry | null;
  /** Fire an urgent notification to admin + unit_head about blacklisted activity */
  notifyActivity: (entry: BlacklistEntry, activity: string) => void;
  refresh: () => void;
  tableReady: boolean;
}

const BlacklistContext = createContext<BlacklistContextValue>({
  entries: [],
  activeEntries: [],
  isPersonBlacklisted: () => null,
  isIdentifierBlacklisted: () => null,
  notifyActivity: () => {},
  refresh: () => {},
  tableReady: false,
});

export function useBlacklist() {
  return useContext(BlacklistContext);
}

export function BlacklistProvider({ children }: { children: React.ReactNode }) {
  const [entries, setEntries] = useState<BlacklistEntry[]>([]);
  const [tableReady, setTableReady] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data, error } = await (supabase
        .from('blacklist')
        .select('*')
        .order('created_at', { ascending: false }) as any);
      if (error) {
        if (error.code === '42P01' || error.message?.includes('blacklist')) {
          setTableReady(false);
          return;
        }
      }
      setTableReady(true);
      setEntries(data || []);
    } catch {
      setTableReady(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const activeEntries = entries.filter(e => e.is_active);

  function isPersonBlacklisted(name: string): BlacklistEntry | null {
    const q = name.toLowerCase().trim();
    return activeEntries.find(e => e.type === 'person' && e.name.toLowerCase().trim() === q) ?? null;
  }

  function isIdentifierBlacklisted(identifier: string): BlacklistEntry | null {
    const q = identifier.toLowerCase().trim();
    return activeEntries.find(e =>
      e.identifier?.toLowerCase().trim() === q ||
      e.name.toLowerCase().trim() === q
    ) ?? null;
  }

  function notifyActivity(entry: BlacklistEntry, activity: string) {
    (supabase.from('notifications') as any).insert({
      target_roles: ['admin', 'unit_head'],
      title: `Blacklisted ${entry.type}: activity detected`,
      body: `${entry.name} — ${activity}`,
      type: 'urgent',
      route: '/dashboard/blacklist',
      actor_name: entry.name,
      actor_role: entry.type,
      read_by: [],
    }).then(() => {}).catch(() => {});
  }

  return (
    <BlacklistContext.Provider
      value={{ entries, activeEntries, isPersonBlacklisted, isIdentifierBlacklisted, notifyActivity, refresh: load, tableReady }}
    >
      {children}
    </BlacklistContext.Provider>
  );
}
