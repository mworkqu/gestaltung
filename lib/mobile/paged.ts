// Reading a whole table through PostgREST.
//
// Supabase answers at most 1,000 rows to one request, whatever `.limit()`
// asks for, and it says nothing when it cuts the answer short. A query written
// as `.limit(3000)` therefore reads the first 1,000 rows and every figure built
// on it is quietly too small — which is how the report came to count 997
// published products out of 1,323. So a table that can pass 1,000 rows is read
// a page at a time with `.range()`, until a page comes back short.
//
// The query MUST have a total order (end it with a unique column such as `id`),
// or two pages can overlap and a row is counted twice while another is missed.

/** The most rows one request is answered with (the project's `max-rows`). */
export const PAGE_ROWS = 1000;

type Result = { data: unknown; error: unknown };

/**
 * Every row of a query, up to `cap`, fetched a page at a time. `page` runs the
 * query for one inclusive row range.
 *
 * A failed page fails the whole read: half a table presented as all of it is
 * the mistake this exists to prevent.
 */
export async function paged<T>(
  page: (from: number, to: number) => PromiseLike<Result>,
  cap: number,
): Promise<{ rows: T[]; error: boolean }> {
  const out: T[] = [];
  while (out.length < cap) {
    const from = out.length;
    const want = Math.min(PAGE_ROWS, cap - from);
    const res = await page(from, from + want - 1);
    if (res.error || !Array.isArray(res.data)) return { rows: [], error: true };
    out.push(...(res.data as T[]));
    if (res.data.length < want) break;
  }
  return { rows: out, error: false };
}
