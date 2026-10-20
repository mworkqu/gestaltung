"use server";

// A teacher's writes (3a, 3b, 3g). Every one of them
//
//   * goes through the RLS cookie client (lib/supabase/server createClient) —
//     never the service role, so a teacher can only ever touch their own rows,
//   * re-checks that the caller holds a signed-in, NON-ANONYMOUS session (the
//     layout gate is not a substitute: a server action is its own entry point),
//   * returns a plain serialisable result whose `error` is a SchoolClasses
//     message key, so the client components render copy and never raw SQL, and
//   * degrades politely before migration 0096/0097 have been run: a missing
//     relation or function answers `errRunMigration` instead of crashing.

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { getAuthUser, getSessionContext } from "@/lib/auth/get-session";
import { createClient } from "@/lib/supabase/server";
import { isValidPhone } from "@/lib/phone";
import { SITE_URL } from "@/lib/seo";
import { studioLibrary } from "@/lib/studio/library/remote";
import { linkedPrices } from "@/lib/studio/server/quote";
import { parseStudioDoc, type StudioDoc } from "@/lib/studio/schema";
import { classPartsPlan, classPartsSummary, type ClassPartsProduct, type ClassTeamDoc } from "@/lib/schools/class-parts";

type PgError = { code?: string; message?: string } | null;

/** The relation or function does not exist yet (0096 / 0097 not run). */
function isMissing(e: PgError): boolean {
  if (!e) return false;
  const code = e.code ?? "";
  if (code === "42P01" || code === "PGRST202" || code === "PGRST205" || code === "42883") return true;
  return /could not find the (?:function|table)|does not exist/i.test(e.message ?? "");
}

const safeLocale = (locale: string) => (locale === "ar" ? "ar" : "en");

/** Message keys of the SchoolClasses namespace that an action may return. */
export type ClassActionError =
  | "errName"
  | "errSchool"
  | "errLimit"
  | "errSignIn"
  | "errFailed"
  | "errRunMigration"
  | "commentTooLong"
  | "commentFailed"
  | "invoiceFailed"
  | "invoiceNeedsPhone";

export type ClassActionResult<T = unknown> = ({ ok: true } & T) | { ok: false; error: ClassActionError };

/** A confirmed, non-anonymous account, with its profile. Null for anyone else. */
async function teacher() {
  const user = await getAuthUser();
  if (!user || user.is_anonymous === true) return null;
  const session = await getSessionContext(user);
  if (!session) return null;
  return { userId: user.id, session };
}

function refreshClasses(locale: string) {
  revalidatePath(`/${safeLocale(locale)}/schools/classes`);
}

// ── 3a. Create a class ──────────────────────────────────────────────────────

export async function createClass(
  locale: string,
  formData: FormData,
): Promise<ClassActionResult<{ classId: string; joinCode: string }>> {
  if (!(await teacher())) return { ok: false, error: "errSignIn" };

  const name = String(formData.get("name") ?? "").trim().slice(0, 200);
  const school = String(formData.get("school") ?? "").trim().slice(0, 200);
  // Same checks the RPC makes, so the teacher sees the problem without a round trip.
  if (!name || name.length > 80) return { ok: false, error: "errName" };
  if (!school || school.length > 120) return { ok: false, error: "errSchool" };

  const supabase = await createClient();
  // create_school_class() mints the unique join code and enforces the 20-open
  // limit; it returns the school_classes ROW.
  const { data, error } = await supabase.rpc("create_school_class", { p_name: name, p_school: school });
  if (error) {
    if (isMissing(error)) return { ok: false, error: "errRunMigration" };
    const message = error.message ?? "";
    if (message.includes("bad_name")) return { ok: false, error: "errName" };
    if (message.includes("bad_school")) return { ok: false, error: "errSchool" };
    if (message.includes("class_limit")) return { ok: false, error: "errLimit" };
    if (message.includes("sign_in")) return { ok: false, error: "errSignIn" };
    console.error("[schools] create_school_class failed:", message);
    return { ok: false, error: "errFailed" };
  }
  const row = (Array.isArray(data) ? data[0] : data) as { id?: string; join_code?: string } | null;
  if (!row?.id) return { ok: false, error: "errFailed" };

  refreshClasses(locale);
  return { ok: true, classId: row.id, joinCode: row.join_code ?? "" };
}

// ── 3a. Archive / reopen a class ────────────────────────────────────────────

export async function setClassArchived(
  locale: string,
  classId: string,
  archived: boolean,
): Promise<ClassActionResult> {
  if (!(await teacher())) return { ok: false, error: "errSignIn" };
  if (!classId) return { ok: false, error: "errFailed" };

  const supabase = await createClient();
  // A plain update: school_classes_update restricts it to the owning teacher.
  const { error } = await supabase.from("school_classes").update({ archived }).eq("id", classId);
  if (error) {
    if (isMissing(error)) return { ok: false, error: "errRunMigration" };
    console.error("[schools] archive class failed:", error.message);
    return { ok: false, error: "errFailed" };
  }

  refreshClasses(locale);
  revalidatePath(`/${safeLocale(locale)}/schools/classes/${classId}`);
  return { ok: true };
}

// ── 3b. A teacher's comment on a team project ───────────────────────────────

export async function addTeamComment(
  locale: string,
  teamId: string,
  body: string,
): Promise<ClassActionResult> {
  const who = await teacher();
  if (!who) return { ok: false, error: "errSignIn" };
  if (!teamId) return { ok: false, error: "errFailed" };

  const text = String(body ?? "").trim();
  if (!text) return { ok: false, error: "errFailed" };
  if (text.length > 2000) return { ok: false, error: "commentTooLong" };

  const supabase = await createClient();
  // author_id is the caller; class_team_comments_insert checks they teach this class.
  const { error } = await supabase
    .from("class_team_comments")
    .insert({ team_id: teamId, author_id: who.userId, body: text });
  if (error) {
    if (isMissing(error)) return { ok: false, error: "errRunMigration" };
    console.error("[schools] add team comment failed:", error.message);
    return { ok: false, error: "commentFailed" };
  }

  // "layout" so the team page the comment was written on refreshes too.
  revalidatePath(`/${safeLocale(locale)}/schools/classes`, "layout");
  return { ok: true };
}

// ── 3g. "Request an invoice" for the class parts order ──────────────────────

/**
 * Posts to the EXISTING lead endpoint (/api/store-lead) as a contact_form of
 * kind "school_invoice", which that route already maps to the tag
 * "School invoice request" in CONTACT_KINDS. Nothing is ordered here: the owner
 * replies with an invoice.
 *
 * The class name, school, number of teams and parts total are computed HERE
 * from the rows the teacher may read, never taken from the browser.
 */
export async function requestSchoolInvoice(
  locale: string,
  classId: string,
): Promise<ClassActionResult> {
  const who = await teacher();
  if (!who) return { ok: false, error: "errSignIn" };
  if (!classId) return { ok: false, error: "invoiceFailed" };

  const lang = safeLocale(locale);
  const supabase = await createClient();

  const { data: klass, error: classError } = await supabase
    .from("school_classes")
    .select("id, name, school_name, join_code")
    .eq("id", classId)
    .maybeSingle();
  if (classError) {
    if (isMissing(classError)) return { ok: false, error: "errRunMigration" };
    console.error("[schools] invoice: class read failed:", classError.message);
    return { ok: false, error: "invoiceFailed" };
  }
  if (!klass) return { ok: false, error: "invoiceFailed" };

  const summary = await classSummaryFor(supabase, classId, lang);

  const name = who.session.profile.full_name?.trim() || who.session.email || "Teacher";
  const phone = who.session.profile.phone?.trim() ?? "";
  // /api/store-lead refuses a lead without a reachable WhatsApp number (422),
  // and profiles.phone is often empty — say which thing to fix.
  if (!phone || !isValidPhone(phone)) return { ok: false, error: "invoiceNeedsPhone" };

  // This deployment's own origin (the lead route is on the same app). Falls
  // back to the canonical site when the headers say nothing.
  const head = await headers();
  const host = head.get("x-forwarded-host") ?? head.get("host");
  const proto = head.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  const origin = host ? `${proto}://${host}` : SITE_URL;

  const row = klass as { name: string; school_name: string };
  const message = [
    `Class: ${row.name}`,
    `School: ${row.school_name}`,
    `Teams: ${summary.teamCount}`,
    `Parts: ${summary.partCount} pieces on ${summary.lineCount} lines`,
    `Parts total: QAR ${summary.goodsQar.toFixed(2)}`,
    `Class page: ${origin}/${lang}/schools/classes/${classId}`,
  ].join("\n");

  try {
    const res = await fetch(`${origin}/api/store-lead`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // Forwarded so /api/store-lead sees the teacher's session: a caller
        // that holds one is exempt from the Turnstile check (leadAllowed).
        ...(head.get("cookie") ? { cookie: head.get("cookie") as string } : {}),
      },
      body: JSON.stringify({
        source: "contact_form",
        kind: "school_invoice",
        name,
        phone,
        email: who.session.email || undefined,
        locale: lang,
        message,
      }),
      cache: "no-store",
    });
    if (!res.ok) {
      console.error("[schools] invoice lead failed:", res.status, await res.text().catch(() => ""));
      return { ok: false, error: "invoiceFailed" };
    }
  } catch (err) {
    console.error("[schools] invoice lead failed:", err);
    return { ok: false, error: "invoiceFailed" };
  }

  return { ok: true };
}

// ── The class parts total, server side ──────────────────────────────────────
// The same read the class page does (app/[locale]/schools/classes/[id]/page.tsx
// loadClassParts): kept here as well because a "use server" file may only
// export async actions, so the two cannot share a helper through this module.

type TeamRow = { id: string; team_name: string; project_id: string };

async function classSummaryFor(
  supabase: Awaited<ReturnType<typeof createClient>>,
  classId: string,
  locale: "en" | "ar",
) {
  const empty = { teamCount: 0, lineCount: 0, partCount: 0, goodsQar: 0 };
  const { data: teamRows, error: teamError } = await supabase
    .from("class_teams")
    .select("id, team_name, project_id")
    .eq("class_id", classId)
    .order("created_at", { ascending: true });
  if (teamError || !teamRows?.length) return empty;

  const teams = teamRows as TeamRow[];
  const { data: projectRows } = await supabase
    .from("projects")
    .select("id, studio")
    .in("id", teams.map((t) => t.project_id));
  const docs = new Map<string, StudioDoc | null>(
    ((projectRows ?? []) as { id: string; studio: unknown }[]).map((p) => [p.id, parseStudioDoc(p.studio)]),
  );

  const classTeams: ClassTeamDoc[] = teams.map((t) => ({
    teamId: t.id,
    teamName: t.team_name,
    projectId: t.project_id,
    doc: docs.get(t.project_id) ?? null,
  }));

  const lib = await studioLibrary().catch(() => null);
  const getPart = (id: string) => lib?.getPart(id);

  // Prices through the established path, one doc at a time, merged.
  const prices = new Map<string, number>();
  for (const t of classTeams) {
    const found = await linkedPrices(supabase, t.doc, getPart).catch(() => new Map<string, number>());
    for (const [sku, price] of found) prices.set(sku, price);
  }
  const products = await packInfo(supabase, [...prices.keys()]);

  return classPartsSummary(classPartsPlan(classTeams, prices, { getPart, products, locale }));
}

/** Pack size and minimum order of the listings we are about to price. */
async function packInfo(
  supabase: Awaited<ReturnType<typeof createClient>>,
  skus: string[],
): Promise<Map<string, ClassPartsProduct>> {
  const out = new Map<string, ClassPartsProduct>();
  if (!skus.length) return out;
  const { data } = await supabase
    .from("parts")
    .select("sku, name, pack_size, min_order_qty")
    .in("sku", skus)
    .eq("is_published", true)
    .is("merged_into", null);
  for (const p of (data ?? []) as ClassPartsProduct[]) out.set(p.sku, p);
  return out;
}
