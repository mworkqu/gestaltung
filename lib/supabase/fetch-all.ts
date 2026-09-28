// PostgREST caps every response at 1,000 rows whatever .limit() says, so a
// "read everything" query silently stops at 1,000. This pages through with
// .range(); the builder must be ordered (e.g. .order("id")) so pages don't
// overlap. Returns the error instead of a partial list.

type PgError = { code?: string; message?: string } | null;

export async function fetchAllRows<T>(
  run: (from: number, to: number) => PromiseLike<{ data: unknown; error: PgError }>,
  pageSize = 1000,
  maxRows = 50_000
): Promise<{ rows: T[]; error: PgError }> {
  const rows: T[] = [];
  for (let from = 0; from < maxRows; from += pageSize) {
    const { data, error } = await run(from, from + pageSize - 1);
    if (error) return { rows: [], error };
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return { rows, error: null };
}
