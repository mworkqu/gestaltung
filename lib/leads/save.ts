// Saving a lead and emailing the owner (the body of /api/store-lead after
// validation). Both steps are best-effort — createLead reports which landed and
// the caller treats "neither" as a failure — so a missing email key never loses
// a lead. All I/O comes in through `deps`, which lets tests record the calls and
// lets a server action create a lead without an HTTP hop back to the route.

import type { SupabaseClient } from "@supabase/supabase-js";

import { parseLeadMessage } from "@/lib/admin/lead-parse";
import { renderLeadEmail } from "@/lib/email/lead-email";
import type { QuoteCalc } from "@/lib/studio/request-summary";

import { printFiles, type ParsedLead } from "./parse";

type PgError = { code?: string; message?: string; details?: string; hint?: string } | null;

export type LeadEmail = { to: string[]; replyTo: string; subject: string; html: string; text: string };

export type LeadDeps = {
  /** The caller's cookie-bound (RLS) client. May throw; every use is guarded. */
  userClient: () => Promise<SupabaseClient>;
  /** The service-role client, or null when its key is missing. */
  serviceClient: () => SupabaseClient | null;
  /** False when the Supabase URL / anon key are not configured: nothing can be saved. */
  canSave: boolean;
  sendEmail: (mail: LeadEmail) => Promise<boolean>;
  ownerEmail: string;
  buildQuoteCalc: (db: SupabaseClient, projectId: string, projectLink: string | null) => Promise<QuoteCalc | null>;
  /** Migration 0073 (quote columns on inquiries) has not been run yet. */
  isMissingQuoteColumn: (e: PgError) => boolean;
  /** This deployment's origin: used for the project links and the email footer. */
  origin: string;
};

export type LeadResult = { saved: boolean; emailed: boolean };

/** True when at least one of the two steps landed. */
export function leadDelivered(r: LeadResult): boolean {
  return r.saved || r.emailed;
}

const join = (parts: (string | null | false)[]): string => parts.filter(Boolean).join("\n\n");

type Composed = { message: string; quoteCalc: QuoteCalc | null; quoteProjectId: string | null };

/** bom_quote: the project link, its name as the caller's own RLS lets them read it (never taken from the request). */
async function composeQuote(deps: LeadDeps, lead: ParsedLead): Promise<string> {
  const { projectId, items, locale, note } = lead;
  let projectName: string | null = null;
  if (projectId) {
    try {
      const supabase = await deps.userClient();
      const { data, error } = await supabase.from("projects").select("name").eq("id", projectId).maybeSingle();
      if (error) console.error("store-lead: project name lookup failed", error);
      projectName = (data?.name as string | undefined) ?? null;
    } catch (err) {
      console.error("store-lead: project name lookup failed", err);
    }
  }
  const link = projectId ? `${deps.origin}/${locale}/projects/${projectId}` : null;
  return join([
    `Quote request for ${items.length} unstocked item${items.length === 1 ? "" : "s"}.`,
    projectId ? `Project: ${projectName ?? "(name not readable)"} — ${link}` : null,
    items.map((i) => `- ${i.function}${i.spec ? ` — ${i.spec}` : ""} × ${i.quantity}`).join("\n"),
    note ? `Note:\n${note}` : null,
  ]).slice(0, 4000);
}

/**
 * studio_quote (W2b): the message plus the estimate calculation, computed HERE
 * from the saved doc (never from the browser) and stored with the lead.
 */
async function composeStudio(deps: LeadDeps, lead: ParsedLead): Promise<Composed> {
  const { projectId, items, locale, note } = lead;
  let quoteCalc: QuoteCalc | null = null;
  let quoteProjectId: string | null = null;
  let projectName: string | null = null;
  const link = projectId ? `${deps.origin}/${locale}/projects/${projectId}/studio` : null;
  if (projectId) {
    try {
      const supabase = await deps.userClient();
      const { data } = await supabase.from("projects").select("name").eq("id", projectId).maybeSingle();
      projectName = (data?.name as string | undefined) ?? null;
      // Only a project the caller can read (RLS) gets a calculation.
      if (data) {
        quoteCalc = await deps.buildQuoteCalc(supabase, projectId, link);
        if (quoteCalc) quoteProjectId = projectId;
      }
    } catch (err) {
      console.error("store-lead: project name / quote lookup failed", err);
    }
  }
  const design = lead.designName || projectName || "Untitled design";
  // P5-16: an unlocked product sends every printed body's STL (the visitor's own cad-files folder only).
  let files: string[] = [];
  if (lead.files !== undefined && projectId) {
    try {
      const supabase = await deps.userClient();
      const { data: auth } = await supabase.auth.getUser();
      files = printFiles(lead.files, auth.user?.id ?? null, projectId);
    } catch (err) {
      console.error("store-lead: studio files lookup failed", err);
    }
  }
  const message = join([
    `Design Studio: ${design}${link ? ` — ${link}` : ""}`,
    projectId ? `Project: ${projectName ?? design}${link ? ` — ${link}` : ""}` : null,
    items.map((i) => `- ${i.function}`).join("\n"),
    note ? `Note:\n${note}` : null,
    files.length ? `Files:\n${files.map((f) => `- ${f}`).join("\n")}` : null,
  ]).slice(0, 4000);
  return { message, quoteCalc, quoteProjectId };
}

/**
 * print_request: "Print request: <name> — <project link> — N parts, ≈ G g, materials …",
 * then one line per part and the STL paths (signed links are minted in the admin Leads page).
 */
async function composePrint(deps: LeadDeps, lead: ParsedLead): Promise<{ message: string; fileCount: number }> {
  const { projectId, items, locale } = lead;
  let projectName: string | null = null;
  let userId: string | null = null;
  try {
    const supabase = await deps.userClient();
    const { data: auth } = await supabase.auth.getUser();
    userId = auth.user?.id ?? null;
    if (projectId) {
      const { data } = await supabase.from("projects").select("name").eq("id", projectId).maybeSingle();
      projectName = (data?.name as string | undefined) ?? null;
    }
  } catch (err) {
    console.error("store-lead: print request lookup failed", err);
  }
  const design = lead.designName || projectName || "Untitled design";
  const link = projectId ? `${deps.origin}/${locale}/projects/${projectId}/studio?step=print` : null;
  const grams = Math.max(
    0,
    Math.round(lead.totalGrams || items.reduce((g, i) => g + (Number(i.spec.match(/(\d+(?:\.\d+)?)\s*g\b/)?.[1]) || 0), 0)),
  );
  const materials = [...new Set(items.map((i) => i.spec.split("·")[0].trim()).filter(Boolean))];
  const files = printFiles(lead.files, userId, projectId);
  const message = join([
    `Print request: ${design}${link ? ` — ${link}` : ""} — ${items.length} part${items.length === 1 ? "" : "s"}, ≈ ${grams} g${materials.length ? `, materials ${materials.join(", ")}` : ""}`,
    projectId ? `Project: ${projectName ?? design}${link ? ` — ${link}` : ""}` : null,
    items.map((i) => `- ${i.function}${i.spec ? ` — ${i.spec}` : ""}`).join("\n"),
    files.length
      ? `Files:\n${files.map((f) => `- ${f}`).join("\n")}`
      : "Files: none uploaded — download them from the project link.",
  ]).slice(0, 8000);
  return { message, fileCount: files.length };
}

/** Save the lead to `inquiries` and email the owner. Resolves to which of the two landed. */
export async function createLead(deps: LeadDeps, lead: ParsedLead): Promise<LeadResult> {
  let message = lead.message;
  let quoteCalc: QuoteCalc | null = null;
  let quoteProjectId: string | null = null;
  let fileCount = 0;

  if (lead.isQuote) {
    message = await composeQuote(deps, lead);
  }
  if (lead.isStudio) {
    const c = await composeStudio(deps, lead);
    ({ message, quoteCalc, quoteProjectId } = c);
  }
  if (lead.isPrint) {
    const c = await composePrint(deps, lead);
    ({ message, fileCount } = c);
  }

  const { name, phone, email, locale, contactKind, src, items } = lead;
  let saved = false;
  let emailed = false;

  // 1) Save to the inquiries table (anon INSERT is allowed by RLS).
  if (deps.canSave) {
    const row = { name, phone, email, message, locale, status: "new" };
    // W2b: a Studio request with its calculation is written by the server
    // (service role) — the 0073 guard nulls these columns for anon/authenticated
    // inserts. Before 0073 (missing column) or without the service key, the
    // plain lead is saved as before; the calculation is only lost, never the lead.
    const svc = quoteCalc && quoteProjectId ? deps.serviceClient() : null;
    if (svc) {
      try {
        const { error } = await svc.from("inquiries").insert({ ...row, project_id: quoteProjectId, quote_calc: quoteCalc });
        saved = !error;
        if (error && !deps.isMissingQuoteColumn(error)) console.error("store-lead: studio quote insert failed", error.message);
      } catch (err) {
        console.error("store-lead: studio quote insert failed", err);
      }
    }
    if (!saved) {
      try {
        const supabase = await deps.userClient();
        const { error } = await supabase.from("inquiries").insert(row);
        saved = !error;
      } catch {
        saved = false;
      }
    }
  }

  // 2) Email the owner: the branded lead alert (lib/email/lead-email.ts). The
  // project id and links stay out of the visible text; the card shows the name.
  try {
    const parsed = parseLeadMessage(message);
    const mail = renderLeadEmail({
      title: `New ${src.label.toLowerCase()}`,
      name,
      phone,
      email,
      type: contactKind?.tag ?? null,
      projectName: parsed.projectName,
      language: locale,
      notes: {
        label: "Message",
        text: [
          parsed.body,
          parsed.notes,
          lead.isPrint && fileCount
            ? `${fileCount} STL file${fileCount === 1 ? "" : "s"} attached — download them from Messages & requests in the dashboard.`
            : null,
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
      siteUrl: deps.origin,
    });
    emailed = await deps.sendEmail({
      to: [deps.ownerEmail],
      replyTo: email || deps.ownerEmail,
      subject: src.subject(name, { count: items.length }) + (contactKind?.subject ?? ""),
      html: mail.html,
      text: mail.text,
    });
  } catch {
    emailed = false;
  }

  return { saved, emailed };
}
