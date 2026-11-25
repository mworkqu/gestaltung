/**
 * The day-before meeting reminder, run by the daily notifications cron
 * (lib/cron/jobs.ts) and therefore by the Mac Mini worker too.
 *
 * NO next/*, no react, no "server-only" anywhere in this file or what it
 * imports — the worker bundle refuses those (CLAUDE.md hard rule). The caller
 * passes the DbClient, exactly like lib/notifications/drain-core.ts.
 *
 * It sends: one e-mail per client who gave an address, and one list to the
 * owner. WhatsApp stays a link the owner taps; there is no paid WhatsApp API.
 */

import type { DbClient } from "@/lib/supabase/db";

import { OWNER_EMAIL, sendEmailResult } from "@/lib/email";
import { renderBrandedEmail } from "@/lib/email/brand-layout";
import { formatPhoneDisplay } from "@/lib/phone";

import { modeLabel } from "./copy";
import { renderMeetingReminderEmail } from "./email";
import { readMeetingSettings, type MeetingSettings } from "./settings";
import { qatarDate, slotLabel } from "./slots";

export type ReminderRow = {
  id: string;
  starts_at: string;
  mode: "online" | "studio";
  name: string;
  phone: string;
  email: string | null;
  locale: "en" | "ar";
  topic: string | null;
  meet_link: string | null;
  invoice_qar: number;
};

export type ReminderSummary = {
  /** Meetings starting tomorrow (Qatar), test rows included in the owner list only. */
  tomorrow: number;
  clientsEmailed: number;
  clientsSkipped: number;
  ownerEmailed: boolean;
  /** The table or the settings row is not there yet (migration 0113). */
  notSetUp?: true;
};

const MISSING = ["42P01", "PGRST202", "PGRST205"];

const isMissing = (error: unknown): boolean => {
  const code = (error as { code?: unknown } | null)?.code;
  const message = String((error as { message?: unknown } | null)?.message ?? "");
  return (typeof code === "string" && MISSING.includes(code)) || /does not exist|schema cache/i.test(message);
};

async function loadSettings(db: DbClient): Promise<MeetingSettings | null> {
  const { data, error } = await db.from("store_settings").select("value").eq("key", "meetings").maybeSingle();
  if (error) return isMissing(error) ? null : readMeetingSettings(undefined);
  return readMeetingSettings(data?.value);
}

/**
 * Reminders for the meetings that start tomorrow in Qatar.
 * `now` is injectable so the test does not depend on the real clock.
 */
export async function runMeetingReminders(db: DbClient, siteUrl: string, now: Date = new Date()): Promise<ReminderSummary> {
  const settings = await loadSettings(db);
  if (!settings) return { tomorrow: 0, clientsEmailed: 0, clientsSkipped: 0, ownerEmailed: false, notSetUp: true };

  const day = qatarDate(now.getTime() + 86_400_000);
  const fromMs = Date.parse(`${day}T00:00:00+03:00`);

  const { data, error } = await db
    .from("meeting_bookings")
    .select<string, ReminderRow>("id, starts_at, mode, name, phone, email, locale, topic, meet_link, invoice_qar")
    .gte("starts_at", new Date(fromMs).toISOString())
    .lt("starts_at", new Date(fromMs + 86_400_000).toISOString())
    .not("status", "in", "(cancelled,no_show)")
    .order("starts_at", { ascending: true });

  if (error) {
    if (isMissing(error)) return { tomorrow: 0, clientsEmailed: 0, clientsSkipped: 0, ownerEmailed: false, notSetUp: true };
    throw new Error(`meeting reminders read failed: ${error.message}`);
  }

  const rows = data ?? [];
  if (rows.length === 0) return { tomorrow: 0, clientsEmailed: 0, clientsSkipped: 0, ownerEmailed: false };

  let clientsEmailed = 0;
  let clientsSkipped = 0;

  for (const row of rows) {
    if (!row.email) {
      clientsSkipped++;
      continue;
    }
    const mail = renderMeetingReminderEmail({
      booking: {
        starts_at: row.starts_at,
        mode: row.mode,
        name: row.name,
        phone: row.phone,
        email: row.email,
        locale: row.locale,
        invoice_qar: Number(row.invoice_qar),
        meet_link: row.meet_link,
      },
      settings,
      // No manage link: only the token's hash is stored.
      manageUrl: "",
      siteUrl,
    });
    const sent = await sendEmailResult({
      to: [row.email],
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      idempotencyKey: `meeting-reminder-${row.id}-${day}`,
    });
    if (sent.ok) clientsEmailed++;
    else clientsSkipped++;
  }

  const ownerEmailed = await sendOwnerList(rows, settings, day, siteUrl);
  return { tomorrow: rows.length, clientsEmailed, clientsSkipped, ownerEmailed };
}

/** Tomorrow's meetings as one list for the owner, in English. */
async function sendOwnerList(rows: ReminderRow[], settings: MeetingSettings, day: string, siteUrl: string): Promise<boolean> {
  const lines = rows.map((r) => {
    const parts = [
      slotLabel(r.starts_at, "en", settings),
      modeLabel(r.mode, "en"),
      r.name,
      formatPhoneDisplay(r.phone),
      r.mode === "online" && !r.meet_link ? "NO MEET LINK YET" : null,
      r.topic ? `“${r.topic}”` : null,
    ].filter((p): p is string => Boolean(p));
    return `- ${parts.join(" · ")}`;
  });

  const { html, text } = renderBrandedEmail({
    locale: "en",
    title: `Meetings tomorrow (${rows.length})`,
    preheader: day,
    bodyText: lines.join("\n"),
    bodyHtml: `<p style="margin:0 0 12px;white-space:pre-line">${lines
      .join("\n")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")}</p>`,
    paragraphs: ["Send the online meeting links on WhatsApp before each meeting."],
    buttons: [{ label: "Open in dashboard", url: `${siteUrl.replace(/\/+$/, "")}/en/dashboard/meetings` }],
    footer: { reason: "You are receiving this because a meeting was booked on the Gestaltung360 website.", help: false },
    siteUrl,
  });

  const sent = await sendEmailResult({
    to: [OWNER_EMAIL],
    subject: `Meetings tomorrow — ${rows.length}`,
    html,
    text,
    idempotencyKey: `meeting-owner-list-${day}`,
  });
  return sent.ok;
}
