/**
 * Active-factory lookup.
 *
 * Retired factories (`plants.is_active = false`) are never deleted — every
 * historical foreign key has to keep resolving, so the row survives and the
 * ticket, asset or stock movement that points at it still renders its name.
 * But they must NOT appear in any picker: after migration 58 the directory
 * holds ten rows and only five are real factories.
 *
 * Filtering has to happen at every read, not just in PlantScopeContext, because
 * a dozen screens fetch `plants` directly for their own dropdowns. This is the
 * one place that rule lives.
 *
 * Degrades gracefully: before migration 57 there is no `is_active` column, so
 * the filtered query errors and we fall back to the unfiltered list rather than
 * blanking every plant picker in the app.
 */
import { supabase } from './supabase';

/** `is_active` is true or NULL — i.e. anything not explicitly retired. */
const ACTIVE_FILTER = 'is_active.is.null,is_active.eq.true';

export async function fetchActivePlants<T>(
  columns = 'id, name',
): Promise<{ data: T[] | null; error: { message?: string } | null }> {
  const filtered = await supabase
    .from('plants').select(columns).or(ACTIVE_FILTER).order('name').returns<T[]>();
  if (!filtered.error) return filtered;

  // Pre-migration-57 database: no is_active column. Fall back to everything.
  // eslint-disable-next-line no-console
  console.warn('[plants] is_active filter unavailable; returning all plants:', filtered.error);
  return await supabase.from('plants').select(columns).order('name').returns<T[]>();
}
