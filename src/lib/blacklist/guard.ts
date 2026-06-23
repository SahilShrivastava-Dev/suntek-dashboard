/**
 * Blacklist screening guard.
 *
 * Drop `useBlacklistGuard()` into any data-entry or OCR flow. Pass the raw
 * entered / extracted values; it fuzzy-matches them against the ACTIVE
 * blacklist (≥ threshold, default 90%), and on a hit it:
 *   1. logs a `match_detected` row to blacklist_events (the audit trail), and
 *   2. fires an urgent notification to admin + unit_head,
 * then returns the matches so the caller can warn the user inline.
 *
 * Lifecycle events (added / resolved / re_added) are logged via logBlacklistEvent.
 */
import { useCallback } from 'react';
import { insertRows } from '../db';
import { useBlacklist, type BlacklistEntry } from '../../contexts/BlacklistContext';
import { useRoleContext } from '../../contexts/RoleContext';
import { similarity, identifierSimilarity, normalize, normalizeId, levRatio } from './similarity';

/** Blacklist severity → notification type, so the bell colour reflects severity. */
const SEVERITY_TYPE: Record<string, 'info' | 'warning' | 'urgent' | 'critical'> = {
  low: 'info', medium: 'warning', high: 'urgent', critical: 'critical',
};

export interface Candidate {
  /** The raw entered / extracted text. */
  value: string;
  /** Which field it came from, e.g. 'Supplier', 'Operator', 'Vehicle no.'. */
  label?: string;
}

export interface BlacklistMatch {
  entry: BlacklistEntry;
  candidate: Candidate;
  /** 0..1 */
  score: number;
  matchedField: 'name' | 'identifier';
  /** The blacklist value that matched. */
  matchedOn: string;
}

export interface GuardContext {
  /** Human workflow label, e.g. 'Purchase Orders', 'Daily Log OCR'. */
  workflow: string;
  /** How the data arrived. */
  source: 'entry' | 'ocr' | 'image' | 'lifecycle';
  /** The record this entry is about (optional). */
  entityLabel?: string;
  imageUrl?: string | null;
}

/** Score one candidate value against one blacklist entry; return the best signal. */
function scoreEntry(value: string, entry: BlacklistEntry): { score: number; field: 'name' | 'identifier'; matchedOn: string } {
  const nameScore = similarity(value, entry.name);
  let idScore = 0;
  let idMatched = '';
  if (entry.identifier) {
    const s = identifierSimilarity(value, entry.identifier);
    if (s > idScore) { idScore = s; idMatched = entry.identifier; }
  }
  // A vehicle/GST number is sometimes stored in `name` — compare id-normalised too.
  const nameAsId = identifierSimilarity(value, entry.name);
  if (nameAsId > idScore) { idScore = nameAsId; idMatched = entry.name; }

  if (idScore >= nameScore) return { score: idScore, field: 'identifier', matchedOn: idMatched || entry.name };
  return { score: nameScore, field: 'name', matchedOn: entry.name };
}

/**
 * Pure screening — match candidates against active blacklist entries.
 * Returns one best match per (entry, candidate) above the threshold, sorted by score.
 */
export function screenCandidates(
  candidates: Candidate[],
  entries: BlacklistEntry[],
  threshold = 0.9,
): BlacklistMatch[] {
  const out: BlacklistMatch[] = [];
  for (const cand of candidates) {
    const v = (cand.value ?? '').toString().trim();
    if (v.length < 3) continue; // too short to screen meaningfully
    for (const entry of entries) {
      if (!entry.is_active) continue;
      const { score, field, matchedOn } = scoreEntry(v, entry);
      if (score >= threshold) out.push({ entry, candidate: cand, score, matchedField: field, matchedOn });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

/** Persist a blacklist audit event (best-effort; degrades if table missing). */
export async function logBlacklistEvent(row: {
  blacklist_id?: string | null;
  event_type: 'added' | 'resolved' | 're_added' | 'escalated' | 'match_detected';
  entity_name: string;
  entity_type?: string | null;
  matched_value?: string | null;
  similarity?: number | null;
  workflow?: string | null;
  source?: string | null;
  actor_id?: string | null;
  actor_name?: string | null;
  actor_role?: string | null;
  image_url?: string | null;
  details?: Record<string, unknown> | null;
}): Promise<void> {
  await insertRows('blacklist_events', {
    blacklist_id: row.blacklist_id ?? null,
    event_type: row.event_type,
    entity_name: row.entity_name,
    entity_type: row.entity_type ?? null,
    matched_value: row.matched_value ?? null,
    similarity: row.similarity ?? null,
    workflow: row.workflow ?? null,
    source: row.source ?? null,
    actor_id: row.actor_id ?? null,
    actor_name: row.actor_name ?? null,
    actor_role: row.actor_role ?? null,
    image_url: row.image_url ?? null,
    details: row.details ?? null,
  }).then(() => {}, () => {});
}

/**
 * The hook. Returns `screen(candidates, ctx)` — call it on save / after OCR.
 * Resolves to the list of matches (empty if clean). On any match it has already
 * logged the audit event(s) and notified admin + unit_head.
 */
export function useBlacklistGuard(threshold = 0.9) {
  const { activeEntries } = useBlacklist();
  const { activeProfile } = useRoleContext();

  return useCallback(
    async (candidates: Candidate[], ctx: GuardContext): Promise<BlacklistMatch[]> => {
      const matches = screenCandidates(candidates, activeEntries, threshold);
      if (!matches.length) return [];

      // Keep the single strongest match per blacklist entry (avoid duplicate noise).
      const bestPerEntry = new Map<string, BlacklistMatch>();
      for (const m of matches) {
        const prev = bestPerEntry.get(m.entry.id);
        if (!prev || m.score > prev.score) bestPerEntry.set(m.entry.id, m);
      }
      const unique = [...bestPerEntry.values()];

      for (const m of unique) {
        const pct = Math.round(m.score * 100);
        // Is the blacklisted entity the very person performing the action?
        const isActor = normalize(m.candidate.value) === normalize(activeProfile.name) && m.candidate.value.trim().length > 0;
        const notifType = SEVERITY_TYPE[m.entry.severity] ?? 'urgent';

        await logBlacklistEvent({
          blacklist_id: m.entry.id,
          event_type: 'match_detected',
          entity_name: m.entry.name,
          entity_type: m.entry.type,
          matched_value: m.candidate.value,
          similarity: m.score,
          workflow: ctx.workflow,
          source: ctx.source,
          actor_id: activeProfile.id,
          actor_name: activeProfile.name,
          actor_role: activeProfile.roleLabel,
          image_url: ctx.imageUrl ?? null,
          details: {
            field: m.candidate.label ?? null,
            matched_on: m.matchedOn,
            entity_label: ctx.entityLabel ?? null,
            severity: m.entry.severity,
            is_actor: isActor,
          },
        });

        // Alert admin + unit head. Colour = blacklist severity.
        const title = isActor
          ? `🚫 Blacklisted ${m.entry.type} active: ${m.entry.name}`
          : `⚠ Blacklisted ${m.entry.type} entered (${pct}% match)`;
        const body = isActor
          ? `${m.entry.name} is on the blacklist (${m.entry.severity}) and just performed: ${ctx.workflow}${ctx.entityLabel ? ` · ${ctx.entityLabel}` : ''}. Reason on file: ${m.entry.reason}`
          : `${activeProfile.name} entered "${m.candidate.value}"${m.candidate.label ? ` (${m.candidate.label})` : ''} in ${ctx.workflow} — ${pct}% match to blacklisted "${m.entry.name}" (${m.entry.severity}). Reason on file: ${m.entry.reason}`;
        await insertRows('notifications', {
          target_roles: ['admin', 'unit_head'],
          title,
          body,
          type: notifType,
          route: '/dashboard/blacklist',
          actor_name: activeProfile.name,
          actor_role: activeProfile.roleLabel,
          read_by: [],
        }).then(() => {}, () => {});
      }

      return unique;
    },
    [activeEntries, activeProfile, threshold],
  );
}

// Re-export so callers can import everything from one place.
export { similarity, identifierSimilarity, normalizeId, levRatio };
