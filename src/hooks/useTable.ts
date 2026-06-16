import { useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { Database } from '../lib/database.types';

type Tables = Database['public']['Tables'];
type TableName = keyof Tables;
type RowOf<T extends TableName> = Tables[T]['Row'];
type InsertOf<T extends TableName> = Tables[T]['Insert'];
type UpdateOf<T extends TableName> = Tables[T]['Update'];

export interface UseTableOptions {
  /** Postgrest select string, e.g. '*' or '*, plants(name)'. Default '*'. */
  select?: string;
  /** Column to order by. */
  orderBy?: string;
  /** Order ascending? Default false (newest first when ordering by created_at). */
  ascending?: boolean;
  /** Equality filters applied with .eq(). */
  filters?: Record<string, string | number | boolean | null>;
  /** Subscribe to Postgres changes and refetch on any change. Default true. */
  realtime?: boolean;
  /** Disable the query (e.g. while a parent id is not yet known). */
  enabled?: boolean;
}

/**
 * One typed data hook for any Supabase table — replaces the repeated
 * `await (supabase.from(...).select('*') as any)` + manual useState/useEffect
 * pattern scattered across the dashboard pages.
 *
 * - Reads via React Query (loading/error/refetch for free; pair with <AsyncState/>).
 * - Optionally subscribes to realtime changes and refetches.
 * - Returns typed insert / update / remove mutations that invalidate the cache.
 *
 * The select string can join related tables (e.g. '*, plants(name)'), so the
 * returned rows may carry extra fields beyond the base Row; pass a widened
 * `<TRow>` in that case.
 */
export function useTable<T extends TableName, TRow = RowOf<T>>(
  table: T,
  options: UseTableOptions = {},
) {
  const {
    select = '*',
    orderBy,
    ascending = false,
    filters,
    realtime = true,
    enabled = true,
  } = options;

  const queryClient = useQueryClient();

  // Stable key for caching / invalidation / realtime scoping.
  const queryKey = useMemo(
    () => ['table', table, { select, orderBy, ascending, filters }] as const,
    [table, select, orderBy, ascending, JSON.stringify(filters)],
  );

  const query = useQuery<TRow[]>({
    queryKey,
    enabled,
    queryFn: async () => {
      // Single, isolated, documented cast: the typed Postgrest builder cannot be
      // expressed generically over a `keyof Tables` union without exploding the
      // types. Confining it here keeps every CALL SITE fully typed.
      let q = (supabase.from(table) as any).select(select);
      if (filters) {
        for (const [col, val] of Object.entries(filters)) q = q.eq(col, val);
      }
      if (orderBy) q = q.order(orderBy, { ascending });
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as TRow[];
    },
  });

  // Realtime: refetch this table's queries on any change.
  useEffect(() => {
    if (!realtime || !enabled) return;
    const channel = supabase
      .channel(`rt:${String(table)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: String(table) }, () => {
        queryClient.invalidateQueries({ queryKey: ['table', table] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [table, realtime, enabled, queryClient]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['table', table] });

  const insert = useMutation({
    mutationFn: async (values: InsertOf<T> | InsertOf<T>[]) => {
      const { data, error } = await (supabase.from(table) as any).insert(values).select();
      if (error) throw error;
      return data as RowOf<T>[];
    },
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: async ({ id, values }: { id: string; values: UpdateOf<T> }) => {
      const { data, error } = await (supabase.from(table) as any).update(values).eq('id', id).select();
      if (error) throw error;
      return data as RowOf<T>[];
    },
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.from(table) as any).delete().eq('id', id);
      if (error) throw error;
      return id;
    },
    onSuccess: invalidate,
  });

  return {
    rows: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error as Error | null,
    refetch: query.refetch,
    isEmpty: !query.isLoading && !query.isError && (query.data?.length ?? 0) === 0,
    insert,
    update,
    remove,
    invalidate,
  };
}
