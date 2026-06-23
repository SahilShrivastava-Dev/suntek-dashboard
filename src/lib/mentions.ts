/**
 * @-mention tagging, CC / watchers, and per-entity notes.
 *
 * "People" you can tag are the merged profile directory from RoleContext
 * (built-in MOCK_PROFILES + active user_accounts rows). A tag is just a
 * profile id, which is the SAME id the notification system already targets
 * via `notifications.target_roles` — so tagging a person lights up their
 * TopBar bell + realtime feed with no extra plumbing.
 *
 * Persistence (entity_notes / entity_watchers) degrades gracefully: if the
 * tables from 10_mentions.sql don't exist yet, the @-autocomplete and the
 * immediate mention notification still work (the notifications table already
 * exists); only the saved note thread / watcher list is skipped.
 */
import { useCallback, useMemo } from 'react';
import { supabase } from './supabase';
import { insertRows } from './db';
import { useRoleContext } from '../contexts/RoleContext';
import type { AppNotification } from '../contexts/NotificationsContext';

export interface TaggablePerson {
  id: string;
  name: string;
  roleLabel: string;
  initials: string;
  plant?: string;
}

type AddNotification = (n: Omit<AppNotification, 'id' | 'created_at' | 'read_by'>) => Promise<void>;

export interface EntityRef {
  entityType: string;
  entityId: string;
  entityLabel: string;
  route?: string | null;
}

export interface Actor {
  id: string;
  name: string;
  /** Human-readable role label, e.g. "Unit Head". */
  role: string;
}

export interface EntityNote {
  id: string;
  entity_type: string;
  entity_id: string;
  author_id: string;
  author_name: string;
  author_role: string | null;
  body: string;
  mentions: string[];
  created_at: string;
}

export interface Watcher {
  profile_id: string;
  profile_name: string;
  kind: string;
}

/** The deduped, sorted directory of people who can be tagged or CC'd. */
export function useDirectory(): TaggablePerson[] {
  const { allProfiles } = useRoleContext();
  return useMemo(() => {
    const seen = new Set<string>();
    const out: TaggablePerson[] = [];
    for (const p of allProfiles) {
      const key = p.name.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ id: p.id, name: p.name, roleLabel: p.roleLabel, initials: p.initials, plant: p.plant });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }, [allProfiles]);
}

/**
 * The one-liner every form should call on save. Pass the free-text value and a
 * reference to the record it was saved on; anyone @-tagged (except you) gets an
 * instant bell notification and becomes a watcher of that record. Safe to call
 * with text that has no mentions (it no-ops) and degrades gracefully if the
 * watcher table is missing.
 *
 *   const notifyMentions = useMentionNotifier();
 *   await notifyMentions(form.notes, { entityType: 'purchase_order', entityId: row.id,
 *       entityLabel: `PO ${row.vendor}`, route: '/dashboard/purchase/purchase' });
 */
export function useMentionNotifier() {
  const people = useDirectory();
  const { activeProfile } = useRoleContext();
  return useCallback(
    async (
      text: string | null | undefined,
      ref: { entityType?: string; entityId?: string; entityLabel: string; route?: string | null },
    ) => {
      const ids = extractMentionIds(text || '', people).filter((id) => id !== activeProfile.id);
      if (!ids.length) return;
      // Direct insert (mirrors the app's other notify() helpers) so it works
      // regardless of NotificationsContext readiness.
      await insertRows('notifications', {
        target_roles: ids,
        title: `${activeProfile.name} mentioned you`,
        body: `${ref.entityLabel}: “${truncate(text || '')}”`,
        type: 'info',
        route: ref.route ?? null,
        actor_name: activeProfile.name,
        actor_role: activeProfile.roleLabel,
        read_by: [],
      }).then(() => {}, () => {});
      // When the tag is attached to a record, leave a persistent trace in that
      // record's Notes thread (so the tagged person can see what was said) and
      // make the tagged people watchers for future changes.
      if (ref.entityType && ref.entityId) {
        await insertRows('entity_notes', {
          entity_type: ref.entityType,
          entity_id: ref.entityId,
          author_id: activeProfile.id,
          author_name: activeProfile.name,
          author_role: activeProfile.roleLabel,
          body: text || '',
          mentions: ids,
        }).then(() => {}, () => {});
        const tagged = people.filter((p) => ids.includes(p.id));
        await addWatchers(
          { entityType: ref.entityType, entityId: ref.entityId, entityLabel: ref.entityLabel, route: ref.route },
          tagged.map((p) => ({ id: p.id, name: p.name })),
          'mention',
          activeProfile.id,
        );
      }
    },
    [people, activeProfile],
  );
}

/** Resolve which people are tagged in a body of text by matching `@Full Name`. */
export function extractMentionIds(text: string, people: TaggablePerson[]): string[] {
  if (!text.includes('@')) return [];
  const ids: string[] = [];
  // Longest names first so "@Vijay Ji" wins over a hypothetical "@Vijay".
  const sorted = [...people].sort((a, b) => b.name.length - a.name.length);
  for (const p of sorted) {
    if (text.includes('@' + p.name)) ids.push(p.id);
  }
  return ids;
}

export function truncate(s: string, n = 120): string {
  const t = s.trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

// ── Watchers ────────────────────────────────────────────────────────────────

export async function getWatchers(entityType: string, entityId: string): Promise<Watcher[]> {
  try {
    const { data, error } = await supabase
      .from('entity_watchers')
      .select('profile_id, profile_name, kind')
      .eq('entity_type', entityType)
      .eq('entity_id', entityId)
      .returns<Watcher[]>();
    if (error) return [];
    return data ?? [];
  } catch {
    return [];
  }
}

export async function addWatchers(
  ref: EntityRef,
  people: { id: string; name: string }[],
  kind: 'cc' | 'mention' | 'author',
  addedBy: string,
): Promise<void> {
  if (!people.length) return;
  const rows = people.map((p) => ({
    entity_type: ref.entityType,
    entity_id: ref.entityId,
    profile_id: p.id,
    profile_name: p.name,
    kind,
    added_by: addedBy,
  }));
  try {
    // Upsert on the (entity_type, entity_id, profile_id) unique key; keep the
    // first 'kind' that was recorded. Cast is local because upsert options
    // aren't expressible through the typed db.ts helpers.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('entity_watchers') as any)
      .upsert(rows, { onConflict: 'entity_type,entity_id,profile_id', ignoreDuplicates: true });
  } catch {
    /* table missing — skip silently */
  }
}

// ── Notes ─────────────────────────────────────────────────────────────────────

/** Lightweight count of notes on an entity (for the Notes button badge). */
export async function getNotesCount(entityType: string, entityId: string): Promise<number> {
  try {
    const { count, error } = await supabase
      .from('entity_notes')
      .select('*', { count: 'exact', head: true })
      .eq('entity_type', entityType)
      .eq('entity_id', entityId);
    if (error) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
}

export async function getNotes(entityType: string, entityId: string): Promise<EntityNote[]> {
  try {
    const { data, error } = await supabase
      .from('entity_notes')
      .select('*')
      .eq('entity_type', entityType)
      .eq('entity_id', entityId)
      .order('created_at', { ascending: true })
      .returns<EntityNote[]>();
    if (error) return [];
    return data ?? [];
  } catch {
    return [];
  }
}

/**
 * Post a note on an entity: persists it, makes the author + mentioned people
 * watchers, and fires an immediate "X mentioned you" notification to everyone
 * tagged (except the author). Returns the saved note, or null if persistence
 * was unavailable (the mention notification still fires).
 */
export async function postNote(opts: {
  ref: EntityRef;
  actor: Actor;
  body: string;
  mentionIds: string[];
  people: TaggablePerson[];
  addNotification: AddNotification;
}): Promise<EntityNote | null> {
  const { ref, actor, body, mentionIds, people, addNotification } = opts;

  let note: EntityNote | null = null;
  try {
    const { data } = await insertRows('entity_notes', {
      entity_type: ref.entityType,
      entity_id: ref.entityId,
      author_id: actor.id,
      author_name: actor.name,
      author_role: actor.role,
      body,
      mentions: mentionIds,
    }).select().single();
    note = (data as EntityNote) ?? null;
  } catch {
    /* persistence unavailable — the mention notification below still fires */
  }

  // Author + tagged people become watchers for future changes.
  await addWatchers(ref, [{ id: actor.id, name: actor.name }], 'author', actor.id);
  const mentioned = people.filter((p) => mentionIds.includes(p.id));
  if (mentioned.length) {
    await addWatchers(ref, mentioned.map((p) => ({ id: p.id, name: p.name })), 'mention', actor.id);
  }

  // Immediate notification to everyone tagged (except yourself).
  const targets = mentionIds.filter((id) => id !== actor.id);
  if (targets.length) {
    await addNotification({
      target_roles: targets,
      title: `${actor.name} mentioned you`,
      body: `${ref.entityLabel}: “${truncate(body)}”`,
      type: 'info',
      route: ref.route ?? null,
      actor_name: actor.name,
      actor_role: actor.role,
    });
  }

  return note;
}

/**
 * Notify everyone watching an entity (CC'd, tagged, or author) that something
 * changed in its workflow. Used at status-transition points. The actor is
 * never notified about their own action. `extraIds` lets you fold in people
 * just-tagged in the same action who may not be persisted as watchers yet.
 */
export async function notifyWatchers(opts: {
  ref: EntityRef;
  actor: Actor;
  title: string;
  body: string;
  type?: AppNotification['type'];
  addNotification: AddNotification;
  extraIds?: string[];
}): Promise<void> {
  const watchers = await getWatchers(opts.ref.entityType, opts.ref.entityId);
  const ids = new Set<string>(watchers.map((w) => w.profile_id));
  (opts.extraIds ?? []).forEach((id) => ids.add(id));
  ids.delete(opts.actor.id);
  if (!ids.size) return;
  await opts.addNotification({
    target_roles: [...ids],
    title: opts.title,
    body: opts.body,
    type: opts.type ?? 'info',
    route: opts.ref.route ?? null,
    actor_name: opts.actor.name,
    actor_role: opts.actor.role,
  });
}
