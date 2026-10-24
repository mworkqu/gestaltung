// "Run migration NNNN first" detection. A page or route that ships ahead of its
// migration gets one of these codes back from PostgREST / Postgres instead of
// rows; callers show a "migration pending" hint rather than a crash.
//
// The code set is exactly the one in app/[locale]/dashboard/ai-costs/format.ts
// `needsMigration` (PGRST202, 42883, 42703, 42P01, PGRST205), split by what is
// missing. PGRST204 (column missing from the schema cache on insert/update) is
// not in that set today and is deliberately not added here: a caller that wants
// it can test the code itself. Pure; accepts anything because callers pass
// `error` straight from a Supabase result.

const RELATION = new Set(["42P01", "PGRST205"]);
const FUNCTION = new Set(["42883", "PGRST202"]);
const COLUMN = new Set(["42703"]);

function codeOf(e: unknown): string {
  if (typeof e !== "object" || e === null) return "";
  const code = (e as { code?: unknown }).code;
  return typeof code === "string" ? code : "";
}

/** A table or view does not exist (Postgres 42P01) or is not in the PostgREST schema cache (PGRST205). */
export function isMissingRelation(e: unknown): boolean {
  return RELATION.has(codeOf(e));
}

/** An RPC / function does not exist (Postgres 42883) or is not in the schema cache (PGRST202). */
export function isMissingFunction(e: unknown): boolean {
  return FUNCTION.has(codeOf(e));
}

/** A column does not exist (Postgres 42703). */
export function isMissingColumn(e: unknown): boolean {
  return COLUMN.has(codeOf(e));
}

/** Any of the above: the schema is behind the code. Same answer as the old `needsMigration`. */
export function isMissingSchemaObject(e: unknown): boolean {
  return isMissingRelation(e) || isMissingFunction(e) || isMissingColumn(e);
}
