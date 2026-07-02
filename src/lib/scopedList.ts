/**
 * withEmbedFallback — resilience wrapper for scoped list queries.
 *
 * Several list pages fetch with a `plants(name)` embed for display. That embed
 * relies on PostgREST's relationship cache, which can transiently break right
 * after a migration (it's what once blanked User Management). This runs the
 * embed query first and, only if it errors, retries with a fallback builder that
 * drops the embed.
 *
 * IMPORTANT: the plant/unit SCOPE filter lives inside the builders (applied by
 * scopeQuery), so data isolation is preserved on BOTH paths — the fallback only
 * loses the joined plant *name*, never the row filtering.
 */
type QueryResult<T> = { data: T | null; error: { message?: string } | null };

export async function withEmbedFallback<T>(
  primary: PromiseLike<QueryResult<T>>,
  fallback: () => PromiseLike<QueryResult<T>>,
  ctx: string,
): Promise<QueryResult<T>> {
  const res = await primary;
  if (res.error) {
    // eslint-disable-next-line no-console
    console.error(`[${ctx}] query failed; retrying without the plants(name) embed:`, res.error);
    return await fallback();
  }
  return res;
}
