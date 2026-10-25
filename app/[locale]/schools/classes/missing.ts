import { isMissingFunction, isMissingRelation } from "@/lib/supabase/errors";

// Shared by the teacher pages and actions: the 0096 / 0097 tables or functions are
// not there yet (migration not run). Code check first, message text as the fallback
// for drivers that drop the code.

export type PgError = { code?: string; message?: string } | null;

export function isMissing(e: PgError): boolean {
  if (!e) return false;
  if (isMissingRelation(e) || isMissingFunction(e)) return true;
  return /could not find the (?:function|table)|does not exist/i.test(e.message ?? "");
}
