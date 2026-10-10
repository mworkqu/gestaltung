import { NextResponse } from "next/server";

import { normalizePhone } from "@/lib/phone";
import { OWNER_EMAIL, sendEmail } from "@/lib/email";
import { renderLeadEmail } from "@/lib/email/lead-email";
import { parseLeadMessage } from "@/lib/admin/lead-parse";
import { createClient } from "@/lib/supabase/server";
import { CAD_BUCKET } from "@/lib/design/constants";
import { readTurnstileToken } from "@/lib/turnstile";
import { checkTurnstile, turnstileEnforced } from "@/lib/turnstile-server";

// Single lead/contact endpoint. Every contact touchpoint on the site posts here
// and each is handled as its own "case" (distinct email subject): the homepage
// callback, the /contact form, and the BOM's one quote request for every
// unstocked line (bom_quote: the items, the note and a link to the project,
// whose name is read under the caller's own RLS). It (1) saves the lead to the inquiries
// table (super_admin reads it in the dashboard) and (2) emails the owner at
// info@gestaltung360.com. Both are best-effort — we succeed if either lands, so
// a missing email key never loses a lead. Email goes out via Resend's REST API
// (free tier, no SDK).

// Per-case labelling. Add a new case here + post its `source` from the form.
const SOURCES: Record<
  string,
  { label: string; subject: (name: string, ctx: { count: number }) => string; fallbackMessage: string }
> = {
  contact_form: {
    label: "Contact form",
    subject: (n) => `New contact message — ${n}`,
    fallbackMessage: "Contact form submission.",
  },
  store_callback: {
    label: "Store callback",
    subject: (n) => `New store callback request — ${n}`,
    fallbackMessage: "Store landing — requested a callback.",
  },
  bom_quote: {
    label: "BOM quote request",
    subject: (n, { count }) => `Quote request — ${n} · ${count} unstocked item${count === 1 ? "" : "s"}`,
    fallbackMessage: "Bill of materials — quote request.",
  },
  drawing_request: {
    label: "Drawing request",
    subject: (n) => `New drawing request — ${n}`,
    fallbackMessage: "Help me draw it — new drawing project.",
  },
  // Design Studio "Get it made" (P5-13): the design name, the project link and
  // the part names. The visitor may have no name on file: a neutral one is used.
  studio_quote: {
    label: "Design Studio request",
    subject: (n) => `Design Studio — get it made — ${n}`,
    fallbackMessage: "Design Studio — get it made.",
  },
  // Design Studio "Request printing" (P5-14): the printable parts of the design,
  // their material and grams, and the STLs the visitor uploaded to their own
  // folder of the private cad-files bucket. Quantity is always 1.
  print_request: {
    label: "Print request",
    subject: (n, { count }) => `Print request — ${n} · ${count} part${count === 1 ? "" : "s"}`,
    fallbackMessage: "Design Studio — print request.",
  },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ITEMS = 60;
const MAX_FILES = 40;
/** cad-files/<user>/<project>/print/<stamp>/<file>.stl — the visitor's own folder (0018 insert policy). */
const PRINT_PATH = /^cad-files\/([0-9a-f-]{36})\/([0-9a-f-]{36})\/print\/[\w-]{1,40}\/[\w.-]{1,80}\.stl$/i;

/** The STL paths of a print request that belong to this user and project; anything else is dropped. */
function printFiles(raw: unknown, userId: string | null, projectId: string | null): string[] {
  if (!Array.isArray(raw) || !userId || !projectId) return [];
  const out: string[] = [];
  for (const v of raw.slice(0, MAX_FILES)) {
    if (typeof v !== "string") continue;
    const m = v.match(PRINT_PATH);
    if (m && m[1].toLowerCase() === userId.toLowerCase() && m[2].toLowerCase() === projectId.toLowerCase() && v.startsWith(`${CAD_BUCKET}/`))
      out.push(v);
  }
  return [...new Set(out)];
}

// contact_form only: /contact?kind=school (from /students) or ?kind=institution (from
// /pricing) tags the lead. The message (saved and emailed) starts with the tag and the
// email subject gets the suffix, so no column is needed.
const CONTACT_KINDS: Record<string, { tag: string; subject: string }> = {
  school: { tag: "School / class project", subject: " (school / class project)" },
  institution: { tag: "Institution / team plan", subject: " (institution / team plan)" },
  partner: { tag: "Partnership", subject: " (partnership)" },
};

type QuoteItem = { function: string; spec: string; quantity: number };

/**
 * Cloudflare Turnstile (P2-08). Switch off or a key missing → always allowed
 * (today's behaviour). Switch on → the body's turnstileToken must pass
 * siteverify, UNLESS the caller already holds a Supabase session (guest or
 * account): minting that session was itself CAPTCHA-checked by Supabase, and
 * the in-workspace forms (bom_quote, drawing_request after ensureSession) have
 * no widget of their own.
 */
async function leadAllowed(request: Request, token: string | null): Promise<boolean> {
  if (!(await turnstileEnforced())) return true;
  if (token && (await checkTurnstile(request, token)).ok) return true;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return !!user;
  } catch {
    return false;
  }
}

/** The BOM lines of a bom_quote, trimmed and capped; anything malformed is dropped. */
function quoteItems(raw: unknown): QuoteItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, MAX_ITEMS)
    .map((x): QuoteItem | null => {
      const o = (x ?? {}) as Record<string, unknown>;
      const fn = String(o.function ?? "").trim().slice(0, 120);
      const qty = Number(o.quantity);
      if (!fn) return null;
      return {
        function: fn,
        spec: String(o.spec ?? "").trim().slice(0, 200),
        quantity: Number.isFinite(qty) && qty >= 1 ? Math.min(Math.trunc(qty), 100000) : 1,
      };
    })
    .filter((x): x is QuoteItem => x !== null);
}

export async function POST(request: Request) {
  let body: {
    name?: string;
    phone?: string;
    email?: string;
    message?: string;
    locale?: string;
    source?: string;
    // contact_form only: "school" | "institution" from /contact?kind=....
    kind?: string;
    // bom_quote / studio_quote only.
    items?: unknown;
    // studio_quote / print_request: the design (product) name from the Studio.
    designName?: string;
    // print_request only: total grams and the uploaded STL paths.
    totalGrams?: number;
    files?: unknown;
    note?: string;
    projectId?: string;
    // P2-08: the Turnstile token from the contact / callback forms.
    turnstileToken?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  if (!(await leadAllowed(request, readTurnstileToken(body as Record<string, unknown> | null)))) {
    return NextResponse.json({ error: "captcha_failed" }, { status: 403 });
  }

  const isStudio = body.source === "studio_quote";
  const isPrint = body.source === "print_request";
  const name = String(body.name ?? "").trim().slice(0, 120) || (isStudio || isPrint ? "Design Studio visitor" : "");
  const phone = normalizePhone(String(body.phone ?? "")).slice(0, 40);
  const email = String(body.email ?? "").trim().slice(0, 160) || null;
  const locale = body.locale === "ar" ? "ar" : "en";
  const src = SOURCES[body.source ?? ""] ?? SOURCES.store_callback;
  const isQuote = body.source === "bom_quote";
  const items = isQuote || isStudio || isPrint ? quoteItems(body.items) : [];
  const contactKind =
    body.source === "contact_form" && typeof body.kind === "string" && Object.hasOwn(CONTACT_KINDS, body.kind)
      ? CONTACT_KINDS[body.kind]
      : null;

  if (!name || !phone || ((isQuote || isStudio || isPrint) && !items.length)) {
    return NextResponse.json({ error: "missing_fields" }, { status: 422 });
  }

  let message = String(body.message ?? "").trim().slice(0, 4000) || src.fallbackMessage;
  if (contactKind && !message.toLowerCase().startsWith(contactKind.tag.toLowerCase())) {
    message = `${contactKind.tag}: ${message}`.slice(0, 4000);
  }
  if (isQuote) {
    // The project link, and its name as the caller's own RLS lets them read
    // it (never taken from the request). A failed read keeps the link only.
    const projectId = typeof body.projectId === "string" && UUID.test(body.projectId) ? body.projectId : null;
    let projectName: string | null = null;
    if (projectId) {
      try {
        const supabase = await createClient();
        const { data, error } = await supabase.from("projects").select("name").eq("id", projectId).maybeSingle();
        if (error) console.error("store-lead: project name lookup failed", error);
        projectName = (data?.name as string | undefined) ?? null;
      } catch (err) {
        console.error("store-lead: project name lookup failed", err);
      }
    }
    const link = projectId ? `${new URL(request.url).origin}/${locale}/projects/${projectId}` : null;
    const note = String(body.note ?? "").trim().slice(0, 1000);
    message = [
      `Quote request for ${items.length} unstocked item${items.length === 1 ? "" : "s"}.`,
      projectId ? `Project: ${projectName ?? "(name not readable)"} — ${link}` : null,
      items.map((i) => `- ${i.function}${i.spec ? ` — ${i.spec}` : ""} × ${i.quantity}`).join("\n"),
      note ? `Note:\n${note}` : null,
    ]
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 4000);
  }

  if (isStudio) {
    // "Design Studio: <name> — <project link>", then the parts (quantity is always 1).
    const projectId = typeof body.projectId === "string" && UUID.test(body.projectId) ? body.projectId : null;
    let projectName: string | null = null;
    if (projectId) {
      try {
        const supabase = await createClient();
        const { data } = await supabase.from("projects").select("name").eq("id", projectId).maybeSingle();
        projectName = (data?.name as string | undefined) ?? null;
      } catch (err) {
        console.error("store-lead: project name lookup failed", err);
      }
    }
    const design = String(body.designName ?? "").replace(/\s+/g, " ").trim().slice(0, 80) || projectName || "Untitled design";
    const link = projectId ? `${new URL(request.url).origin}/${locale}/projects/${projectId}/studio` : null;
    message = [
      `Design Studio: ${design}${link ? ` — ${link}` : ""}`,
      projectId ? `Project: ${projectName ?? design}${link ? ` — ${link}` : ""}` : null,
      items.map((i) => `- ${i.function}`).join("\n"),
    ]
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 4000);
  }

  let fileCount = 0;
  if (isPrint) {
    // "Print request: <name> — <project link> — N parts, ≈ G g, materials …", then one
    // line per part and the STL paths (signed links are minted in the admin Leads page).
    const projectId = typeof body.projectId === "string" && UUID.test(body.projectId) ? body.projectId : null;
    let projectName: string | null = null;
    let userId: string | null = null;
    try {
      const supabase = await createClient();
      const { data: auth } = await supabase.auth.getUser();
      userId = auth.user?.id ?? null;
      if (projectId) {
        const { data } = await supabase.from("projects").select("name").eq("id", projectId).maybeSingle();
        projectName = (data?.name as string | undefined) ?? null;
      }
    } catch (err) {
      console.error("store-lead: print request lookup failed", err);
    }
    const design = String(body.designName ?? "").replace(/\s+/g, " ").trim().slice(0, 80) || projectName || "Untitled design";
    const link = projectId ? `${new URL(request.url).origin}/${locale}/projects/${projectId}/studio?step=print` : null;
    const grams = Math.max(0, Math.round(Number(body.totalGrams) || items.reduce((g, i) => g + (Number(i.spec.match(/(\d+(?:\.\d+)?)\s*g\b/)?.[1]) || 0), 0)));
    const materials = [...new Set(items.map((i) => i.spec.split("·")[0].trim()).filter(Boolean))];
    const files = printFiles(body.files, userId, projectId);
    fileCount = files.length;
    message = [
      `Print request: ${design}${link ? ` — ${link}` : ""} — ${items.length} part${items.length === 1 ? "" : "s"}, ≈ ${grams} g${materials.length ? `, materials ${materials.join(", ")}` : ""}`,
      projectId ? `Project: ${projectName ?? design}${link ? ` — ${link}` : ""}` : null,
      items.map((i) => `- ${i.function}${i.spec ? ` — ${i.spec}` : ""}`).join("\n"),
      files.length
        ? `Files:\n${files.map((f) => `- ${f}`).join("\n")}`
        : "Files: none uploaded — download them from the project link.",
    ]
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 8000);
  }

  let saved = false;
  let emailed = false;

  // 1) Save to the inquiries table (anon INSERT is allowed by RLS).
  if (
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    try {
      const supabase = await createClient();
      const { error } = await supabase
        .from("inquiries")
        .insert({ name, phone, email, message, locale, status: "new" });
      saved = !error;
    } catch {
      saved = false;
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
          isPrint && fileCount
            ? `${fileCount} STL file${fileCount === 1 ? "" : "s"} attached — download them from Messages & requests in the dashboard.`
            : null,
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
      siteUrl: new URL(request.url).origin,
    });
    emailed = await sendEmail({
      to: [OWNER_EMAIL],
      replyTo: email || OWNER_EMAIL,
      subject: src.subject(name, { count: items.length }) + (contactKind?.subject ?? ""),
      html: mail.html,
      text: mail.text,
    });
  } catch {
    emailed = false;
  }

  if (!saved && !emailed) {
    return NextResponse.json({ error: "not_delivered" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, saved, emailed });
}
