/**
 * The Gestaltung360 chat-plugin MCP server: four tools, one resource, one prompt.
 * Everything that touches Supabase, e-mail or the network comes in through
 * PluginServerDeps (real wiring: ./deps.ts), so tests run in-process with fakes.
 *
 * Privacy rule: no tool takes a conversation. send_project sends a structured
 * build file (every field capped, unknown keys stripped) plus optional contact
 * details; the chat itself never reaches us.
 */
import { createHash, randomBytes } from "node:crypto";

import { CLIENT_INFO_META_KEY, type CallToolResult, type McpServer, type ServerContext } from "@modelcontextprotocol/server";
import { z } from "zod";

import { leadsDashboardUrl, renderOwnerEmail } from "@/lib/email/lead-email";
import type { BrandFact } from "@/lib/email/brand-layout";
import { isPlausibleEmail } from "@/lib/email-address";
import { formatQar } from "@/lib/format/money";
import { pluginProjectSubject, type PluginChatSource } from "@/lib/leads/sources";
import { companyLine, meetingLines, modeLabel, modeLine } from "@/lib/meetings/copy";
import { meetingBookedSubject, meetingLeadMessage, renderMeetingClientEmail, renderMeetingOwnerEmail } from "@/lib/meetings/email";
import type { MeetingMode, MeetingSettings } from "@/lib/meetings/settings";
import { slotLabel, slotOptions } from "@/lib/meetings/slots";
import { isValidPhone, normalizePhone } from "@/lib/phone";
import { STORE_CATEGORIES, type StoreCategory } from "@/lib/store/store-categories";
import { escapeHtml } from "@/lib/text/escape";
import type { StudioDoc } from "@/lib/studio/schema";
import { BuildFileSchema, type BuildFile } from "../build-file";
import { checkProject, storeSkusFor, type CheckResult, type PluginProduct } from "../check-project";
import { designRules, designRulesText } from "../design-rules";
import { previewPayload, PREVIEW_MIME, PREVIEW_URI } from "../preview";
import type { PluginLibrary } from "../to-studio";
import { PREVIEW_UI_META, PREVIEW_WIDGET_HTML } from "./preview-widget";

export const SERVER_INFO = { name: "gestaltung360", version: "1.0.0" } as const;

export const ENGINEER_LINE = "Our engineer reviews your file and quotes the best method within one working day.";

export const SERVER_INSTRUCTIONS = [
  "Gestaltung360 is a company in Qatar that makes electronic products from a person's idea: parts, wiring, code and a 3D-printed case.",
  "How to work: ask what the product must do; call get_design_rules; choose parts only by their library id from it; write the build file and call check_project until ok is true; describe how it will look and work, with the parts and their total in QAR.",
  "Then call preview_look to show the user how it will look.",
  "Before sending, list exactly what will be sent (summary, parts, wiring, code, the look and the case design notes) and ask the user to agree. Never call send_project without the user's explicit agreement.",
  "Never send the chat. requirement_quotes holds at most 10 short quotes (140 characters each) of the user's own words, for key requirements only.",
  "Prices are in QAR. Never name CAD software to the user. Never promise that anything is free, and never promise a reprint or a remake.",
  `After sending, give the user the link and say: "${ENGINEER_LINE}"`,
  "If the user wants to talk to the engineer, offer a paid meeting: call list_meeting_slots, show the times, the price and the cancellation rule, and call book_meeting only after the user explicitly agrees.",
].join("\n");

/** Per hashed IP. Reads per hour, checks per hour, sends and bookings per day. */
export const RATE_LIMITS = { read: 120, check: 30, send: 10, meeting: 10 } as const;
/** Kept as its own name because the owner's brief names it. */
export const MEETING_LIMIT = RATE_LIMITS.meeting;

/** Which buckets count per day rather than per hour. */
const DAILY_BUCKETS: readonly RateKind[] = ["send", "meeting"];

export type RateKind = keyof typeof RATE_LIMITS;

export const TEXT_RATE_LIMITED = "Too many requests from your network. Please wait and try again later.";
export const TEXT_FAILED = "Something went wrong on our side. Please try again.";
export const TEXT_NOT_SET_UP = "Sending is being set up and is not available yet. Please try again later.";

const HANDOFF_DAYS = 30;
const LEAD_MESSAGE_MAX = 8000;

/** Thrown by a dep when the database side (0112, service key) is not there yet. */
export class PluginNotSetUpError extends Error {
  constructor(message = "plugin hand-offs are not set up") {
    super(message);
    this.name = "PluginNotSetUpError";
  }
}

export type SearchPartRow = {
  sku: string;
  name: string;
  name_ar: string | null;
  price_qar: number;
  pack_size: number | null;
  lead_time_class: string;
  arrives_by: string | null;
  url: string;
};

export type HandoffInsert = {
  token_hash: string;
  source: PluginChatSource;
  build: BuildFile;
  studio_doc: StudioDoc;
  parts_total_qar: number;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  locale: "en" | "ar";
  ip_hash: string | null;
  expires_at: string;
};

export type LeadInsert = { name: string; phone: string; email: string | null; locale: "en" | "ar"; message: string };

export type OwnerMail = { subject: string; html: string; text: string };

// ── meetings (Phase 2) ───────────────────────────────────────────────────────

export type MeetingBookRequest = {
  startsAt: string;
  mode: MeetingMode;
  name: string;
  phone: string;
  email: string | null;
  locale: "en" | "ar";
  topic: string | null;
  handoffId: string | null;
  /** Which AI chat is booking it (0114), read from the client info. */
  chatSource: PluginChatSource;
};

export type MeetingBookOutcome =
  | { ok: true; startsAt: string; mode: MeetingMode; manageUrl: string; invoiceQar: number }
  | { ok: false; error: "slot_taken" | "too_soon" | "bad_slot" | "too_many" | "not_set_up" | "failed" };

export interface PluginServerDeps {
  loadLibrary(): Promise<PluginLibrary>;
  loadProducts(skus: string[]): Promise<ReadonlyMap<string, PluginProduct>>;
  searchParts(query: string, category: StoreCategory | undefined, limit: number, locale: "en" | "ar"): Promise<SearchPartRow[]>;
  minWallMm(): Promise<number>;
  /** sha256(salt:ip) of the caller, or null when there is no request / no IP. */
  ipHash(req: Request | undefined): string | null;
  /** Counts one hit; false = over the limit. */
  rateHit(key: string, limit: number): Promise<boolean>;
  /** Throws PluginNotSetUpError when the table / service key is missing. */
  storeHandoff(row: HandoffInsert): Promise<{ id: string }>;
  createLead(row: LeadInsert): Promise<{ id: string }>;
  linkLead(handoffId: string, inquiryId: string): Promise<void>;
  sendOwnerEmail(mail: OwnerMail): Promise<boolean>;
  /** One e-mail to one address (the client's confirmation). */
  sendClientEmail(to: string, mail: OwnerMail): Promise<boolean>;
  // meetings (Phase 2)
  meetingSettings(): Promise<MeetingSettings>;
  /** Free slot start times as ISO instants, already clamped to the horizon. */
  freeMeetingSlots(days: number): Promise<string[]>;
  bookMeeting(req: MeetingBookRequest): Promise<MeetingBookOutcome>;
  /** The hand-off a `/handoff/<token>` link of ours names, or null. */
  handoffIdForToken(token: string): Promise<string | null>;
  siteUrl: string;
  now(): Date;
}

// ── helpers ──────────────────────────────────────────────────────────────────

type Json = Record<string, unknown>;

/** One-line summary first, then the same data as JSON for clients that ignore structuredContent. */
function reply(summary: string, data: Json): CallToolResult {
  return { content: [{ type: "text", text: summary }, { type: "text", text: JSON.stringify(data) }], structuredContent: data };
}

const errorReply = (text: string): CallToolResult => ({ content: [{ type: "text", text }], isError: true });

/** Never let an exception's message or stack reach the client's AI. */
async function guarded(tool: string, run: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof PluginNotSetUpError) return errorReply(TEXT_NOT_SET_UP);
    console.error(`[mcp] ${tool} failed:`, err);
    return errorReply(TEXT_FAILED);
  }
}

/** YYYYMMDDHH in Asia/Qatar (UTC+3, no DST). */
export function qatarHour(now: Date): string {
  return new Date(now.getTime() + 3 * 3_600_000).toISOString().slice(0, 13).replace(/[-T]/g, "");
}

export function rateKey(kind: RateKind, ipHash: string | null, now: Date): string {
  const h = qatarHour(now);
  return `mcp:${kind}:${ipHash ?? "noip"}:${DAILY_BUCKETS.includes(kind) ? h.slice(0, 8) : h}`;
}

export function sourceFromName(name: string | null | undefined): PluginChatSource {
  const n = (name ?? "").toLowerCase();
  if (n.includes("claude")) return "claude";
  if (n.includes("openai") || n.includes("chatgpt")) return "chatgpt";
  return "other";
}

/**
 * Best-effort client name: the per-request clientInfo envelope (2026-07-28 protocol),
 * then the initialize handshake (only on a connected transport; stateless HTTP has none
 * on tools/call), then the User-Agent header.
 */
function clientSource(server: McpServer, ctx: ServerContext): PluginChatSource {
  const pick = (v: unknown): string | null =>
    v && typeof v === "object" && typeof (v as { name?: unknown }).name === "string" ? (v as { name: string }).name : null;
  const envelope = ctx.mcpReq.envelope as Record<string, unknown> | undefined;
  const meta = ctx.mcpReq._meta as Record<string, unknown> | undefined;
  const name =
    pick(envelope?.[CLIENT_INFO_META_KEY]) ??
    pick(meta?.[CLIENT_INFO_META_KEY]) ??
    server.server.getClientVersion()?.name ??
    ctx.http?.req?.headers.get("user-agent") ??
    "";
  return sourceFromName(name);
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/**
 * The hand-off token inside one of OUR links, or null. A link on any other host
 * is ignored rather than followed, so a project can only ever be attached to a
 * meeting through a gestaltung360.com hand-off.
 */
export function handoffTokenFromLink(link: string, siteUrl: string): string | null {
  try {
    const u = new URL(link.trim());
    if (u.host !== new URL(siteUrl).host) return null;
    return /^\/(?:en|ar)\/handoff\/([A-Za-z0-9_-]{20,200})\/?$/.exec(u.pathname)?.[1] ?? null;
  } catch {
    return null;
  }
}

/** What the client's AI is told when the database refuses a booking. */
const BOOK_FAIL_TEXT: Record<Exclude<MeetingBookOutcome & { ok: false }, { ok: true }>["error"], string> = {
  slot_taken: "That time has just been taken. Call list_meeting_slots again and offer the user another time.",
  too_soon: "That time is too soon. Offer a time further ahead from list_meeting_slots.",
  bad_slot: "That is not one of our meeting times. Use a starts_at exactly as list_meeting_slots returned it.",
  too_many: "This number already has two meetings booked. Ask the user to move or cancel one first.",
  not_set_up: TEXT_NOT_SET_UP,
  failed: TEXT_FAILED,
};

function publicCheck(r: CheckResult) {
  return {
    ok: r.ok,
    problems: r.problems,
    warnings: r.warnings,
    parts: r.parts,
    parts_total_qar: r.parts_total_qar,
    wiring_summary: r.wiring_summary,
  };
}

async function runCheck(deps: PluginServerDeps, build: BuildFile, locale: "en" | "ar"): Promise<CheckResult> {
  const lib = await deps.loadLibrary();
  const products = await deps.loadProducts(storeSkusFor(build, lib));
  return checkProject(build, { lib, products }, { locale });
}

type ContactCheck =
  | { ok: true; name: string | null; phone: string | null; email: string | null }
  | { ok: false; problems: string[] };

/** Optional contact details: a given phone must be valid (stored as E.164), a given email plausible. */
function readContact(c: { name?: string; phone?: string; email?: string } | undefined): ContactCheck {
  const problems: string[] = [];
  const rawPhone = c?.phone?.trim() || "";
  const phoneOk = !rawPhone || isValidPhone(rawPhone);
  if (!phoneOk)
    problems.push("contact.phone: the phone number looks wrong. Ask for a WhatsApp number with the country code, e.g. +974 5555 1234, or leave it out.");
  const email = c?.email?.trim() || "";
  if (email && !isPlausibleEmail(email)) problems.push("contact.email: the email address looks wrong. Ask again or leave it out.");
  if (problems.length) return { ok: false, problems };
  return { ok: true, name: c?.name?.trim() || null, phone: rawPhone ? normalizePhone(rawPhone) : null, email: email || null };
}

const problemsLine = (n: number) => `${n} problem${n === 1 ? "" : "s"} to fix before sending.`;

// ── lead message + owner e-mail (pure, exported for tests) ──────────────────

const CHAT_NAME: Record<PluginChatSource, string> = { claude: "Claude", chatgpt: "ChatGPT", other: "an AI chat" };

function partLines(r: CheckResult): string[] {
  return r.parts.map((p) =>
    p.status === "in_store" && p.price_qar !== undefined
      ? `- ${p.qty} × ${p.name} (${p.sku}) — ${formatQar(p.price_qar, "en")}`
      : `- ${p.qty} × ${p.name} — we source it`,
  );
}

/** The inquiries.message. First line is exactly "Plugin project: <name>" (lib/admin/lead-kind.ts keys on it). */
export function pluginLeadMessage(build: BuildFile, r: CheckResult, source: PluginChatSource, siteUrl: string): string {
  const s = build.summary;
  const lines = [
    `Plugin project: ${build.name}`,
    `Sent from: ${CHAT_NAME[source]}`,
    `What it does: ${s.what_it_does}`,
    s.who_for && `Who for: ${s.who_for}`,
    `Where used: ${s.where_used}`,
    `Power: ${s.power}`,
    s.size_note && `Size: ${s.size_note}`,
    ...(s.decisions.length ? ["Decisions:", ...s.decisions.map((d) => `- ${d}`)] : []),
    ...(build.requirement_quotes.length ? ["Client's words:", ...build.requirement_quotes.map((q) => `- "${q}"`)] : []),
    `Look: ${build.look.template}, ${build.look.colour}, ${build.look.finish}${build.look.label ? `, label "${build.look.label}"` : ""}`,
    `Parts total: ${formatQar(r.parts_total_qar, "en")}`,
    "Parts:",
    ...partLines(r),
    `Wiring: ${r.wiring_summary}`,
    `Admin: ${siteUrl.replace(/\/+$/, "")}/en/dashboard/leads`,
  ].filter((l): l is string => Boolean(l));
  const text = lines.join("\n");
  return text.length > LEAD_MESSAGE_MAX ? `${text.slice(0, LEAD_MESSAGE_MAX - 1)}…` : text;
}

export function pluginOwnerEmail(input: {
  build: BuildFile;
  result: CheckResult;
  source: PluginChatSource;
  contact: { name: string | null; phone: string | null; email: string | null };
  locale: "en" | "ar";
  siteUrl: string;
}): OwnerMail {
  const { build, result: r, source, contact, siteUrl } = input;
  const subject = pluginProjectSubject(build.name, source);
  const s = build.summary;

  const facts: BrandFact[] = [{ label: "Project", value: build.name }];
  if (contact.name) facts.push({ label: "Name", value: contact.name });
  if (contact.phone) facts.push({ label: "WhatsApp", value: contact.phone, ltr: true });
  if (contact.email) facts.push({ label: "Email", value: contact.email, href: `mailto:${contact.email}`, ltr: true });
  facts.push(
    { label: "Sent from", value: CHAT_NAME[source] },
    { label: "Language", value: input.locale === "ar" ? "Arabic" : "English" },
    { label: "Parts total", value: formatQar(r.parts_total_qar, "en") },
  );

  const paragraphs = [
    `What it does: ${s.what_it_does}`,
    s.who_for && `Who for: ${s.who_for}`,
    `Where used: ${s.where_used} · Power: ${s.power}${s.size_note ? ` · Size: ${s.size_note}` : ""}`,
    `Look: ${build.look.template}, ${build.look.colour}, ${build.look.finish}${build.look.label ? `, label "${build.look.label}"` : ""}${build.look.notes ? ` — ${build.look.notes}` : ""}`,
    `Wiring: ${r.wiring_summary}`,
  ].filter((p): p is string => Boolean(p));

  // Sections as plain text + escaped HTML (pre blocks keep code formatting).
  const sections: { title: string; body: string; pre?: boolean }[] = [];
  if (s.decisions.length) sections.push({ title: "Decisions", body: s.decisions.map((d) => `- ${d}`).join("\n") });
  sections.push({ title: "Parts", body: [...partLines(r), `Parts total: ${formatQar(r.parts_total_qar, "en")}`].join("\n") });
  if (r.warnings.length) sections.push({ title: "Warnings", body: r.warnings.map((w) => `- ${w}`).join("\n") });
  if (build.wiring_notes) sections.push({ title: "Wiring notes from the chat", body: build.wiring_notes });
  if (build.code) sections.push({ title: "Code", body: `Arduino sketch for ${build.code.board}, ${build.code.source.split("\n").length} lines (in the project).` });
  if (build.cad.prompt) sections.push({ title: "Case brief", body: build.cad.prompt, pre: true });
  if (build.cad.openscad) sections.push({ title: "OpenSCAD code", body: build.cad.openscad, pre: true });

  const pre = "font-family:Menlo,Consolas,monospace;font-size:12px;white-space:pre-wrap;word-break:break-word;background:#f3f5f8;padding:10px;border-radius:6px;margin:0 0 16px";
  const bodyHtml = sections
    .map(
      (sec) =>
        `<h3 style="font-size:14px;margin:16px 0 6px">${escapeHtml(sec.title)}</h3>` +
        (sec.pre
          ? `<pre style="${pre}">${escapeHtml(sec.body)}</pre>`
          : `<p style="margin:0 0 12px;white-space:pre-line">${escapeHtml(sec.body)}</p>`),
    )
    .join("");
  const bodyText = sections.map((sec) => `${sec.title}\n${sec.body}`).join("\n\n");

  const { html, text } = renderOwnerEmail({
    title: subject,
    preheader: `${build.name} · ${formatQar(r.parts_total_qar, "en")}`,
    facts,
    paragraphs,
    quote: build.requirement_quotes.length
      ? { label: "The client's own words", text: build.requirement_quotes.map((q) => `"${q}"`).join("\n") }
      : undefined,
    bodyHtml,
    bodyText,
    buttons: [{ label: "Open in dashboard", url: leadsDashboardUrl(siteUrl) }],
    siteUrl,
  });
  return { subject, html, text };
}

// ── prompt ───────────────────────────────────────────────────────────────────

export const DESIGN_A_PRODUCT_PROMPT = [
  "Help me design an electronic product that Gestaltung360 (a company in Qatar) can make for me. Work step by step:",
  "1. Ask me what the product must do, who it is for, where it will be used (indoor, outdoor or both), how it is powered and any size wishes. Ask short questions, one or two at a time.",
  "2. Call get_design_rules and choose parts only by their library id from it. Never invent a part.",
  "3. Write the build file and call check_project. Fix every problem it reports and call it again until ok is true. Tell me the parts and the total in QAR.",
  "4. Call preview_look so I can see how it will look, and describe it too: the case shape, colour, finish, any label, where the openings go.",
  "5. List exactly what will be sent: the summary, the parts, the wiring, the code, the look and the case design notes. The chat itself is never sent; only up to 10 short quotes (max 140 characters each) of my own words for key requirements. Ask me clearly whether I agree to send it.",
  "6. Only after I say yes, call send_project. Never send without my explicit agreement.",
  `7. Give me the link it returns and tell me: "${ENGINEER_LINE}"`,
  "8. Then ask whether I would like to talk to the engineer. If I do, call list_meeting_slots, show me the times in my language with the price and the cancellation rule, and call book_meeting only after I say yes.",
  "Rules: prices are in QAR; never name CAD software to me; never promise that anything is free; never promise a reprint or a remake.",
].join("\n");

// ── registration ─────────────────────────────────────────────────────────────

const LOCALE = z.enum(["en", "ar"]);

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

export function registerPluginServer(server: McpServer, deps: PluginServerDeps): void {
  const limited = async (kind: RateKind, ctx: ServerContext): Promise<boolean> => {
    const key = rateKey(kind, deps.ipHash(ctx.http?.req), deps.now());
    return !(await deps.rateHit(key, RATE_LIMITS[kind]));
  };

  const rules = async () => designRules(await deps.loadLibrary(), { minWallMm: await deps.minWallMm() });

  server.registerTool(
    "get_design_rules",
    {
      title: "Get Gestaltung360 design rules",
      description:
        "Returns what a Gestaltung360 product can be made from: the parts library (choose parts only by these library ids), case templates, colours and finishes, how the case is made (printer, build volume, minimum wall), the design rules, and the build file JSON schema with an example. Call this before choosing parts.",
      annotations: READ_ONLY,
    },
    (ctx) =>
      guarded("get_design_rules", async () => {
        if (await limited("read", ctx)) return errorReply(TEXT_RATE_LIMITED);
        const r = await rules();
        return reply(`${r.parts.length} parts and the design rules.`, r as unknown as Json);
      }),
  );

  server.registerTool(
    "search_parts",
    {
      title: "Search the Gestaltung360 store",
      description:
        "Searches the Gestaltung360 store in Qatar for products by words, optionally in one store category. Returns only products we can deliver, with the price in QAR, the pack size, the delivery date and a link. Use it to answer questions about a product; a build file still names parts by library id from get_design_rules.",
      inputSchema: z.object({
        query: z.string().trim().min(1).max(80).describe("Search words, e.g. 'soil moisture sensor'."),
        category: z.enum(STORE_CATEGORIES).optional(),
        limit: z.number().int().min(1).max(12).default(6),
        locale: LOCALE.default("en"),
      }),
      annotations: READ_ONLY,
    },
    (args, ctx) =>
      guarded("search_parts", async () => {
        if (await limited("read", ctx)) return errorReply(TEXT_RATE_LIMITED);
        const parts = (await deps.searchParts(args.query, args.category, args.limit, args.locale)).slice(0, args.limit);
        return reply(`Found ${parts.length} parts for '${args.query}'.`, { parts });
      }),
  );

  // Input validation: the real BuildFileSchema is the input schema, so the client's AI sees
  // every field. @modelcontextprotocol/server 2.4 answers a schema failure as a tool result
  // with isError: true and the zod messages ("Input validation error: …"), which the model
  // reads and fixes — not a protocol error. Anything that parses then goes through
  // checkProject, whose own problems come back as ok:false.
  server.registerTool(
    "check_project",
    {
      title: "Check a project",
      description:
        "Checks a build file against Gestaltung360's rules: maps the parts to our circuit (our rules add helper parts such as resistors and drivers), recomputes the wiring, and prices the parts in QAR. Returns ok, problems to fix, warnings, the parts with prices, the parts total and a wiring summary. Call it again after every fix until ok is true. Nothing is sent or saved.",
      inputSchema: z.object({ build: BuildFileSchema }),
      annotations: READ_ONLY,
    },
    (args, ctx) =>
      guarded("check_project", async () => {
        if (await limited("check", ctx)) return errorReply(TEXT_RATE_LIMITED);
        const r = await runCheck(deps, args.build, "en");
        return reply(r.ok ? "Ready to send." : problemsLine(r.problems.length), publicCheck(r));
      }),
  );

  server.registerTool(
    "send_project",
    {
      title: "Send the project to Gestaltung360",
      description:
        "Sends this project to Gestaltung360 (a Qatar company) so their engineer can quote and make it. Only call this after the user has explicitly agreed to send it, after you listed what will be sent: summary, parts, wiring, code, the look and the case design notes. The chat itself is never sent. Returns a link for the user to open the project; it works for 30 days.",
      inputSchema: z.object({
        build: BuildFileSchema,
        contact: z
          .object({
            name: z.string().trim().max(60).optional().describe("The user's name, if they gave it."),
            phone: z.string().trim().max(20).optional().describe("WhatsApp number with country code, if the user gave it."),
            email: z.string().trim().max(160).optional(),
          })
          .optional()
          .describe("Only details the user chose to share."),
        locale: LOCALE.default("en").describe("The user's language for the project link."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    (args, ctx) =>
      guarded("send_project", async () => {
        if (await limited("send", ctx)) return errorReply(TEXT_RATE_LIMITED);
        const { build, locale } = args;

        const r = await runCheck(deps, build, locale);
        const refuse = (problems: string[], warnings: string[] = []) =>
          reply(`Not sent: ${problemsLine(problems.length)}`, {
            ok: false,
            problems,
            warnings,
            next: "Fix these problems, run check_project again, then send.",
          });
        if (!r.ok || !r.doc) return refuse(r.problems.length ? r.problems : ["The project could not be checked."], r.warnings);

        const contact = readContact(args.contact);
        if (!contact.ok) return refuse(contact.problems);
        const { name, phone, email } = contact;

        const source = clientSource(server, ctx);
        const ipHash = deps.ipHash(ctx.http?.req);
        const now = deps.now();
        const expiresAt = new Date(now.getTime() + HANDOFF_DAYS * 86_400_000).toISOString();

        // Only the hash is stored; the token itself exists only in the link we return.
        const token = randomBytes(32).toString("base64url");
        const handoff = await deps.storeHandoff({
          token_hash: sha256(token),
          source,
          build,
          studio_doc: r.doc,
          parts_total_qar: r.parts_total_qar,
          contact_name: name,
          contact_phone: phone,
          contact_email: email,
          locale,
          ip_hash: ipHash,
          expires_at: expiresAt,
        });

        // The hand-off is saved: from here on a failure is logged, never shown.
        try {
          const lead = await deps.createLead({
            name: name || "Chat plugin client",
            phone: phone ?? "",
            email,
            locale,
            message: pluginLeadMessage(build, r, source, deps.siteUrl),
          });
          await deps.linkLead(handoff.id, lead.id);
        } catch (err) {
          console.error("[mcp] send_project: lead not saved:", err);
        }
        try {
          const sent = await deps.sendOwnerEmail(
            pluginOwnerEmail({ build, result: r, source, contact: { name, phone, email }, locale, siteUrl: deps.siteUrl }),
          );
          if (!sent) console.warn("[mcp] send_project: owner email not sent");
        } catch (err) {
          console.error("[mcp] send_project: owner email failed:", err);
        }

        const link = `${deps.siteUrl.replace(/\/+$/, "")}/${locale}/handoff/${token}`;
        const summaryLine = `${build.name}: ${r.parts.length} parts, parts total ${formatQar(r.parts_total_qar, locale)}. ${ENGINEER_LINE}`;
        return reply(`Sent. Open your project: ${link}`, { ok: true, link, expires_at: expiresAt, summary_line: summaryLine });
      }),
  );

  // ── how it will look (Phase 3, MCP Apps UI) ────────────────────────────────

  server.registerTool(
    "preview_look",
    {
      title: "Show how it will look",
      description:
        "Shows the user how the product will look: the case shape, its colour and finish, the parts with their prices in QAR and the total. On a client that can show a card the user sees it rendered; everywhere else the same facts come back as text. Nothing is sent or saved.",
      inputSchema: z.object({ build: BuildFileSchema, locale: LOCALE.default("en") }),
      annotations: READ_ONLY,
      // MCP Apps (spec 2026-01-26) links a tool to its UI resource with
      // _meta.ui.resourceUri; openai/outputTemplate is ChatGPT's alias for the
      // same thing, so one server satisfies both hosts.
      _meta: {
        ui: { resourceUri: PREVIEW_URI },
        "openai/outputTemplate": PREVIEW_URI,
      },
    },
    (args, ctx) =>
      guarded("preview_look", async () => {
        if (await limited("check", ctx)) return errorReply(TEXT_RATE_LIMITED);
        const { build, locale } = args;

        const r = await runCheck(deps, build, locale);
        if (!r.ok) return reply(`Not ready to show: ${problemsLine(r.problems.length)}`, { ok: false, problems: r.problems, warnings: r.warnings });

        const payload = previewPayload(build, r, { locale, company: companyLine(locale) });
        // A host without MCP Apps gets exactly the same facts as text, and the
        // hand-off page stays the full preview.
        const text = [
          `${payload.name} — ${payload.look.shape}, ${payload.look.colour}, ${payload.look.finish}${payload.look.label ? `, label "${payload.look.label}"` : ""}.`,
          ...payload.parts.map((p) => `- ${p.qty} × ${p.name}${p.price ? ` — ${p.price}` : ""}`),
          `Parts total: ${payload.parts_total}`,
          payload.wiring_summary,
        ].join("\n");

        // `build` rides along so the card's Send button can call send_project.
        return {
          content: [{ type: "text", text }],
          structuredContent: { ...payload, build } as unknown as Json,
        };
      }),
  );

  server.registerResource(
    "preview",
    PREVIEW_URI,
    { title: "How it will look", description: "The product's case, its parts and the total in QAR.", mimeType: PREVIEW_MIME },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: PREVIEW_MIME, text: PREVIEW_WIDGET_HTML, _meta: PREVIEW_UI_META }],
    }),
  );

  // ── meetings (Phase 2) ─────────────────────────────────────────────────────

  server.registerTool(
    "list_meeting_slots",
    {
      title: "List free meeting times with the engineer",
      description:
        "Lists the free times in the next three weeks for a paid one-hour meeting with a Gestaltung360 engineer, online or at the studio in Lusail, Qatar. Times are Qatar time. Returns the price in QAR and the payment and cancellation rules. Nothing is booked by this tool.",
      inputSchema: z.object({
        days: z.number().int().min(1).max(21).default(21).describe("How many days ahead to look."),
        locale: LOCALE.default("en").describe("The user's language for the time labels."),
      }),
      annotations: READ_ONLY,
    },
    (args, ctx) =>
      guarded("list_meeting_slots", async () => {
        if (await limited("read", ctx)) return errorReply(TEXT_RATE_LIMITED);
        const settings = await deps.meetingSettings();
        const slots = slotOptions(await deps.freeMeetingSlots(args.days), settings);
        const lines = meetingLines(settings, args.locale);
        const summary = slots.length
          ? `${slots.length} free time${slots.length === 1 ? "" : "s"}. ${lines[0]}`
          : "No free times in that period. Ask the user to try a later date.";
        return reply(summary, {
          slots,
          price_qar: settings.price_qar,
          lines,
          modes: settings.modes.map((m) => ({ mode: m, label: modeLabel(m, args.locale), detail: modeLine(m, args.locale) })),
          company: companyLine(args.locale),
        });
      }),
  );

  server.registerTool(
    "book_meeting",
    {
      title: "Book the meeting with the engineer",
      description:
        "Books one paid meeting with a Gestaltung360 engineer at a time from list_meeting_slots. Only call this after the user has explicitly agreed to book it and has seen the price and the cancellation rule. It is invoiced after the meeting and only if the user is happy. Returns the time, the price and a link where the user can move or cancel it.",
      inputSchema: z.object({
        starts_at: z.string().trim().min(10).max(40).describe("A starts_at exactly as list_meeting_slots returned it."),
        mode: z.enum(["online", "studio"]).describe("online = we send a Google Meet link on WhatsApp; studio = at our studio in Lusail."),
        name: z.string().trim().min(1).max(60),
        phone: z.string().trim().min(6).max(20).describe("WhatsApp number with the country code, e.g. +974 5555 1234."),
        email: z.string().trim().max(160).optional().describe("Only if the user wants a confirmation by e-mail."),
        topic: z.string().trim().max(400).optional().describe("What the user wants to talk about, in their own short words."),
        handoff_link: z.string().trim().max(300).optional().describe("The gestaltung360.com project link from send_project, if there is one."),
        locale: LOCALE.default("en"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    (args, ctx) =>
      guarded("book_meeting", async () => {
        if (await limited("meeting", ctx)) return errorReply(TEXT_RATE_LIMITED);
        const { locale } = args;
        const settings = await deps.meetingSettings();

        if (!isValidPhone(args.phone)) {
          return reply("Not booked: the phone number looks wrong.", {
            ok: false,
            problems: ["phone: ask for a WhatsApp number with the country code, e.g. +974 5555 1234."],
          });
        }
        const email = args.email?.trim() || "";
        if (email && !isPlausibleEmail(email)) {
          return reply("Not booked: the email address looks wrong.", {
            ok: false,
            problems: ["email: ask again or leave it out."],
          });
        }
        const startsAt = new Date(args.starts_at);
        if (Number.isNaN(startsAt.getTime())) {
          return reply("Not booked: that is not a time we offer.", {
            ok: false,
            problems: ["starts_at: use a value exactly as list_meeting_slots returned it."],
          });
        }

        const handoffId = args.handoff_link
          ? await deps.handoffIdForToken(handoffTokenFromLink(args.handoff_link, deps.siteUrl) ?? "")
          : null;

        const booked = await deps.bookMeeting({
          chatSource: clientSource(server, ctx),
          startsAt: startsAt.toISOString(),
          mode: args.mode,
          name: args.name,
          phone: normalizePhone(args.phone),
          email: email || null,
          locale,
          topic: args.topic?.trim() || null,
          handoffId,
        });
        if (!booked.ok) {
          if (booked.error === "not_set_up" || booked.error === "failed") return errorReply(BOOK_FAIL_TEXT[booked.error]);
          return reply(`Not booked: ${BOOK_FAIL_TEXT[booked.error]}`, { ok: false, problems: [BOOK_FAIL_TEXT[booked.error]] });
        }

        const bookingForMail = {
          starts_at: booked.startsAt,
          mode: booked.mode,
          name: args.name,
          phone: normalizePhone(args.phone),
          email: email || null,
          locale,
          topic: args.topic?.trim() || null,
          source: "plugin" as const,
          invoice_qar: booked.invoiceQar,
        };
        const mailInput = { booking: bookingForMail, settings, manageUrl: booked.manageUrl, siteUrl: deps.siteUrl };
        const timeLabel = slotLabel(booked.startsAt, locale, settings);

        // The meeting is booked: from here on a failure is logged, never shown.
        try {
          const lead = await deps.createLead({
            name: args.name,
            phone: normalizePhone(args.phone),
            email: email || null,
            locale,
            message: meetingLeadMessage(mailInput),
          });
          void lead;
        } catch (err) {
          console.error("[mcp] book_meeting: lead not saved:", err);
        }
        try {
          const sent = await deps.sendOwnerEmail(renderMeetingOwnerEmail(mailInput));
          if (!sent) console.warn("[mcp] book_meeting: owner email not sent", { subject: meetingBookedSubject(args.name, timeLabel) });
        } catch (err) {
          console.error("[mcp] book_meeting: owner email failed:", err);
        }
        if (email) {
          try {
            await deps.sendClientEmail(email, renderMeetingClientEmail(mailInput));
          } catch (err) {
            console.error("[mcp] book_meeting: client email failed:", err);
          }
        }

        const lines = meetingLines(settings, locale);
        return reply(`Booked: ${timeLabel} (${modeLabel(booked.mode, locale)}). Manage it here: ${booked.manageUrl}`, {
          ok: true,
          starts_at: booked.startsAt,
          label: timeLabel,
          mode: booked.mode,
          mode_detail: modeLine(booked.mode, locale),
          price_qar: booked.invoiceQar,
          lines,
          manage_link: booked.manageUrl,
          company: companyLine(locale),
        });
      }),
  );

  server.registerResource(
    "design-rules",
    "gestaltung://design-rules",
    { title: "Gestaltung360 design rules", description: "Parts library, case options, making limits and the build file schema.", mimeType: "text/markdown" },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: designRulesText(await rules()) }] }),
  );

  server.registerPrompt(
    "design_a_product",
    {
      title: "Design a product with Gestaltung360",
      description: "Walks through designing a product Gestaltung360 can make, checking it, and sending it only with your agreement.",
    },
    () => ({ messages: [{ role: "user", content: { type: "text", text: DESIGN_A_PRODUCT_PROMPT } }] }),
  );
}
