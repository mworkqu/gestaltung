// Admin announcements (Prompt 11 Step F) — PURE: validation, recipient
// selection, batch planning and the bilingual email rendering. The database
// and the sending are announcements-server.ts.
//
// Rules
//   marketing  -> only students with marketing_consent (opt-out respected)
//   essential  -> ignores marketing_consent (account / safety / schedule news)
//   both       -> skip students with a deletion request and students with no email
// The recipients are the Students filters (students.ts), so the picker and the
// student table always agree.

import { renderBrandedEmail, BRAND, escapeHtmlText } from "@/lib/email/brand-layout";

import type { CcAnnouncementKind } from "../db/types";
import { matchesStudentFilters, type StudentFilters, type StudentRow } from "./students";

export const ANNOUNCEMENT_KINDS = ["marketing", "essential"] as const satisfies readonly CcAnnouncementKind[];
/** Deliveries sent per server action call (keeps one call well under the function time limit). */
export const BATCH_SIZE = 25;
export const SUBJECT_MAX = 150;
export const BODY_MAX = 5000;

export interface AnnouncementDraft {
  kind: CcAnnouncementKind;
  subjectEn: string;
  subjectAr: string;
  bodyEn: string;
  bodyAr: string;
}

export type AnnouncementError =
  | "kind"
  | "subject_en_required"
  | "subject_ar_required"
  | "body_en_required"
  | "body_ar_required"
  | "subject_too_long"
  | "body_too_long";

export function validateAnnouncement(input: Partial<Record<keyof AnnouncementDraft, unknown>>): { ok: true; value: AnnouncementDraft } | { ok: false; errors: AnnouncementError[] } {
  const s = (v: unknown) => (typeof v === "string" ? v.replace(/\r\n/g, "\n").trim() : "");
  const value: AnnouncementDraft = {
    kind: input.kind === "essential" ? "essential" : "marketing",
    // Subjects are one line (no CR/LF reaches the mail subject).
    subjectEn: s(input.subjectEn).replace(/[\r\n]+/g, " "),
    subjectAr: s(input.subjectAr).replace(/[\r\n]+/g, " "),
    bodyEn: s(input.bodyEn),
    bodyAr: s(input.bodyAr),
  };
  const errors: AnnouncementError[] = [];
  if (input.kind !== "marketing" && input.kind !== "essential") errors.push("kind");
  if (!value.subjectEn) errors.push("subject_en_required");
  if (!value.subjectAr) errors.push("subject_ar_required");
  if (!value.bodyEn) errors.push("body_en_required");
  if (!value.bodyAr) errors.push("body_ar_required");
  if (value.subjectEn.length > SUBJECT_MAX || value.subjectAr.length > SUBJECT_MAX) errors.push("subject_too_long");
  if (value.bodyEn.length > BODY_MAX || value.bodyAr.length > BODY_MAX) errors.push("body_too_long");
  return errors.length ? { ok: false, errors } : { ok: true, value };
}

// ---------------------------------------------------------------- recipients

export interface RecipientSelection {
  recipients: StudentRow[];
  /** Matched the filters but not emailed. */
  skipped: { noEmail: number; deletionRequested: number; noConsent: number };
}

/** A plausible address (the real check is the mail provider's). */
export function hasEmail(row: Pick<StudentRow, "email">): boolean {
  return !!row.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email.trim());
}

export function selectRecipients(rows: readonly StudentRow[], filters: StudentFilters, kind: CcAnnouncementKind, now: number): RecipientSelection {
  const recipients: StudentRow[] = [];
  const skipped = { noEmail: 0, deletionRequested: 0, noConsent: 0 };
  for (const r of rows) {
    if (!matchesStudentFilters(r, filters, now)) continue;
    if (r.deletionRequested) skipped.deletionRequested++;
    else if (!hasEmail(r)) skipped.noEmail++;
    else if (kind === "marketing" && !r.marketingConsent) skipped.noConsent++;
    else recipients.push(r);
  }
  return { recipients, skipped };
}

/** Idempotency key for one delivery (Resend dedupes a repeat inside its window). */
export function deliveryKey(announcementId: string, userId: string): string {
  return `cc-announcement-${announcementId}-${userId}`;
}

export function batchCount(pending: number, size: number = BATCH_SIZE): number {
  return pending <= 0 ? 0 : Math.ceil(pending / Math.max(1, size));
}

/** Splits ids into batches (used when inserting delivery rows). */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  const n = Math.max(1, Math.floor(size));
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n));
  return out;
}

export type AnnouncementStatusValue = "draft" | "sending" | "sent" | "failed";

/** Status after a batch: still sending while anything is pending; failed only when nothing at all went out. */
export function nextStatus(c: { pending: number; sent: number; failed: number }): AnnouncementStatusValue {
  if (c.pending > 0) return "sending";
  if (c.sent === 0 && c.failed > 0) return "failed";
  return "sent";
}

// ---------------------------------------------------------------- body (markdown-lite)

const URL_RE = /\[([^\]\n]{1,120})\]\((https:\/\/[^\s)]{1,300})\)/g;

function inlineHtml(raw: string): string {
  let out = escapeHtmlText(raw);
  out = out.replace(/\*\*([^*\n]{1,200})\*\*/g, "<strong>$1</strong>");
  // links: the url was escaped with the rest (&amp; stays valid in an href)
  out = out.replace(/\[([^\]\n]{1,120})\]\((https:\/\/[^\s)]{1,300})\)/g, (_m, label: string, url: string) => `<a href="${url}" style="color:${BRAND.cobalt}">${label}</a>`);
  return out;
}

function inlineText(raw: string): string {
  return raw.replace(/\*\*([^*\n]{1,200})\*\*/g, "$1").replace(URL_RE, (_m, label: string, url: string) => `${label} (${url})`);
}

/**
 * Body text to email HTML + a plain-text twin. Supported: blank-line paragraphs,
 * "- " bullet lists, **bold**, [label](https://link). Everything else is escaped.
 */
export function renderBody(body: string, ar: boolean): { html: string; text: string } {
  const blocks = body.replace(/\r\n/g, "\n").trim().split(/\n{2,}/);
  const align = ar ? "right" : "left";
  const htmlParts: string[] = [];
  const textParts: string[] = [];
  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trimEnd());
    if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
      const items = lines.map((l) => l.replace(/^\s*[-*]\s+/, ""));
      htmlParts.push(`<ul style="margin:0 0 14px;padding-${ar ? "right" : "left"}:22px;text-align:${align}">${items.map((i) => `<li style="margin:0 0 6px;font-size:15px;line-height:1.6;color:${BRAND.body}">${inlineHtml(i)}</li>`).join("")}</ul>`);
      textParts.push(items.map((i) => `- ${inlineText(i)}`).join("\n"));
    } else {
      htmlParts.push(`<p style="margin:0 0 14px;font-size:15px;line-height:1.65;color:${BRAND.body};text-align:${align}">${lines.map(inlineHtml).join("<br/>")}</p>`);
      textParts.push(lines.map(inlineText).join("\n"));
    }
  }
  return { html: htmlParts.join(""), text: textParts.join("\n\n") };
}

// ---------------------------------------------------------------- email

const REASON = {
  marketing: {
    en: "You get this email because you agreed to receive CAD Champions news. You can turn it off in your account settings.",
    ar: "وصلتك هذه الرسالة لأنك وافقت على استلام أخبار CAD Champions. يمكنك إيقافها من إعدادات حسابك.",
  },
  essential: {
    en: "You get this email because it is about your CAD Champions account or training.",
    ar: "وصلتك هذه الرسالة لأنها تخص حسابك أو تدريبك في CAD Champions.",
  },
} as const;

export interface AnnouncementEmail {
  subject: string;
  html: string;
  text: string;
}

/** Arabic first, then English (like the other CC emails). */
export function renderAnnouncementEmail(d: AnnouncementDraft, opts: { siteUrl?: string; testPrefix?: boolean } = {}): AnnouncementEmail {
  const ar = renderBody(d.bodyAr, true);
  const en = renderBody(d.bodyEn, false);
  const enBlock = `<div dir="ltr" lang="en" style="margin:18px 0 6px;padding:14px 0 0;border-top:1px solid ${BRAND.border};text-align:left;font-family:Arial,Helvetica,sans-serif"><p style="margin:0 0 12px;font-size:17px;line-height:1.5;font-weight:bold;color:${BRAND.ink}">${escapeHtmlText(d.subjectEn)}</p>${en.html}</div>`;
  const reason = REASON[d.kind];
  const { html, text } = renderBrandedEmail({
    locale: "ar",
    title: d.subjectAr,
    preheader: firstLine(d.bodyAr, 90),
    bodyHtml: ar.html + enBlock,
    bodyText: `${ar.text}\n\n${d.subjectEn}\n\n${en.text}`,
    footer: { reason: `${reason.ar} · ${reason.en}` },
    ...(opts.siteUrl ? { siteUrl: opts.siteUrl } : {}),
  });
  const prefix = opts.testPrefix ? "[Test] " : "";
  return { subject: `${prefix}${d.subjectAr} · ${d.subjectEn}`, html, text };
}

export function firstLine(s: string, max: number): string {
  const t = s.replace(/[*\[\]()]/g, "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
