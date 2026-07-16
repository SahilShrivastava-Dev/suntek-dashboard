import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useRoleContext } from './RoleContext';
import { usePlantScope } from './PlantScopeContext';
import { useNotifications } from './NotificationsContext';
import { TODO_SECTIONS, buildUrgentItems } from '../lib/todo/sections';
import type { TodoCtx, TodoSectionResult, TodoItem } from '../lib/todo/sections';

/**
 * TodoContext — the personal work queue.
 *
 * A single provider computes "what is pending on me" ONCE (from the section
 * registry in lib/todo/sections.tsx) and serves both the To-Do page and the
 * TopBar / Sidebar count badges, so nothing is fetched twice. It is purely
 * read-only: every source table's own status/assignee columns are the truth, so
 * an item vanishes the moment the underlying work advances — no writes, no drift.
 *
 * Ownership is resolved from existing primitives (RoleContext identity +
 * PlantScope scoping + the notifications feed); see sections.tsx for the model.
 *
 * The DB-sourced sections are loaded in an effect; the notification-sourced
 * "urgent alerts" section is derived as a memo from the live notifications feed
 * (no extra query) and merged in — so a new ping updates the badge instantly
 * without re-hitting the database for everything else.
 */

interface TodoContextValue {
  /** Applicable, NON-EMPTY sections (empty ones are hidden), in priority order. */
  sections: TodoSectionResult[];
  /** Total pending items across all sections (the badge count). */
  totalCount: number;
  isLoading: boolean;
  /** True once identity + plant scope have resolved and a first load ran. */
  ready: boolean;
  refresh: () => void;
}

const TodoContext = createContext<TodoContextValue>({
  sections: [], totalCount: 0, isLoading: false, ready: false, refresh: () => {},
});

export function useTodo() {
  return useContext(TodoContext);
}

const URGENT_KEY = 'urgent-alerts';

export function TodoProvider({ children }: { children: React.ReactNode }) {
  const { activeProfile, activePersonId, roles } = useRoleContext();
  const { scopeQuery, ready: scopeReady, plants } = usePlantScope();
  const { notifications } = useNotifications();

  const [dbSections, setDbSections] = useState<TodoSectionResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [nonce, setNonce] = useState(0);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  // ── Resolve the owner identity for the active profile ───────────────────────
  // accountId = user_accounts.id, recovered from the person's `db_<uuid>` id
  // (RoleContext resolves this robustly via the auth link; slice off the prefix).
  const accountId = useMemo(
    () => (activePersonId.startsWith('db_') ? activePersonId.slice(3) : null),
    [activePersonId],
  );

  // Role slugs the active profile answers to (admin '*' → sees every section).
  const roleSlugsKey = useMemo(() => {
    const set = new Set<string>();
    if (activeProfile.allowedDashboardRoutes.includes('*')) set.add('*');
    if (activeProfile.baseRoleId) set.add(activeProfile.baseRoleId);
    // A built-in archetype's id IS the role slug (provisioned users use db_<uuid>).
    if (roles.some((r) => r.id === activeProfile.id)) set.add(activeProfile.id);
    return [...set].sort().join(',');
  }, [activeProfile.id, activeProfile.baseRoleId, activeProfile.allowedDashboardRoutes, roles]);

  const personName = activeProfile.name || '';

  // Resolve a plant_id → display name (from PlantScope reference data).
  const plantNameKey = useMemo(() => plants.map((p) => `${p.id}:${p.name}`).join(','), [plants]);
  const plantName = useCallback((plantId: string | null | undefined): string => {
    if (!plantId) return '';
    return plants.find((p) => p.id === plantId)?.name ?? '';
  }, [plants]);

  const buildBaseCtx = useCallback((): Omit<TodoCtx, 'notifications'> => ({
    personName,
    accountId,
    roleSlugs: new Set(roleSlugsKey ? roleSlugsKey.split(',') : []),
    scopeQuery,
    plantName,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [personName, accountId, roleSlugsKey, scopeQuery, plantNameKey]);

  // ── Load: run every applicable DB-sourced section's fetch in parallel ───────
  // The notification-sourced 'urgent-alerts' section is handled by the memo below.
  useEffect(() => {
    if (!scopeReady) return;
    let cancelled = false;
    setIsLoading(true);

    const ctx: TodoCtx = { ...buildBaseCtx(), notifications: [] };
    const applicable = TODO_SECTIONS.filter((s) => s.key !== URGENT_KEY && s.appliesTo(ctx));

    Promise.all(
      applicable.map(async (s): Promise<TodoSectionResult> => {
        const base = { key: s.key, titleKey: s.titleKey, icon: s.icon, tone: s.tone, columns: s.columns };
        try {
          return { ...base, items: await s.fetch(ctx) };
        } catch {
          // A missing column / not-yet-run migration must not blank the whole page.
          return { ...base, items: [] as TodoItem[] };
        }
      }),
    ).then((results) => {
      if (cancelled) return;
      setDbSections(results.filter((r) => r.items.length > 0));
      setIsLoading(false);
      setReady(true);
    });

    return () => { cancelled = true; };
  }, [scopeReady, buildBaseCtx, nonce]);

  // ── Realtime: refresh the DB sections when any source table changes ─────────
  // Debounced so a burst of writes triggers a single reload.
  useEffect(() => {
    if (!scopeReady) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const bump = () => { clearTimeout(timer); timer = setTimeout(refresh, 400); };
    const channel = supabase
      .channel('todo-feed')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'maintenance_tickets' }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'store_requisitions' }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'night_duty' }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'anomaly_flags' }, bump)
      .subscribe();
    return () => { clearTimeout(timer); supabase.removeChannel(channel); };
  }, [scopeReady, refresh]);

  // ── Urgent-alerts section — derived live from the notifications feed ────────
  // Reuses buildUrgentItems (same row shape as the registry) so the table columns
  // stay in one place; the DB load above skips this section (URGENT_KEY).
  const urgentSection = useMemo<TodoSectionResult | null>(() => {
    const def = TODO_SECTIONS.find((s) => s.key === URGENT_KEY);
    if (!def) return null;
    const ctx: TodoCtx = { ...buildBaseCtx(), notifications };
    if (!def.appliesTo(ctx)) return null;
    const items = buildUrgentItems(notifications);
    if (items.length === 0) return null;
    return { key: def.key, titleKey: def.titleKey, icon: def.icon, tone: def.tone, columns: def.columns, items };
  }, [notifications, buildBaseCtx]);

  // ── Merge + order by the registry's priority ────────────────────────────────
  const sections = useMemo(() => {
    const all = urgentSection ? [...dbSections, urgentSection] : dbSections;
    const order = new Map(TODO_SECTIONS.map((s, i) => [s.key, i]));
    return [...all].sort((a, b) => (order.get(a.key) ?? 99) - (order.get(b.key) ?? 99));
  }, [dbSections, urgentSection]);

  const totalCount = useMemo(
    () => sections.reduce((sum, s) => sum + s.items.length, 0),
    [sections],
  );

  return (
    <TodoContext.Provider value={{ sections, totalCount, isLoading, ready, refresh }}>
      {children}
    </TodoContext.Provider>
  );
}
