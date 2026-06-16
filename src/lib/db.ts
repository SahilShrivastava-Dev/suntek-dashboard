import { supabase } from './supabase';
import type { Database } from './database.types';

type Tables = Database['public']['Tables'];
type TableName = keyof Tables;

/**
 * Typed write helpers.
 *
 * The schema in database.types.ts is intentionally "loose" (see the note there),
 * so the typed client resolves `.insert()/.update()` payloads to `never`. These
 * helpers enforce the Insert/Update SHAPE at the CALL SITE, then confine the one
 * unavoidable cast to this single file — instead of scattering
 * `(supabase.from(x) as any)` across every page. Reads stay fully typed via
 * `supabase.from(x).select(...).returns<T>()`.
 *
 * The returned builder is chainable (`.select().single()`, `.eq(...)`, etc.)
 * exactly like the native query builder.
 */
export function insertRows<T extends TableName>(
  table: T,
  values: Tables[T]['Insert'] | Tables[T]['Insert'][],
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (supabase.from(table) as any).insert(values);
}

export function updateRows<T extends TableName>(table: T, values: Tables[T]['Update']) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (supabase.from(table) as any).update(values);
}

export function upsertRows<T extends TableName>(
  table: T,
  values: Tables[T]['Insert'] | Tables[T]['Insert'][],
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (supabase.from(table) as any).upsert(values);
}
