"use server";

import { revalidatePath } from "next/cache";

import { requireSuperAdmin } from "@/lib/auth/guards";
import { OWNER_EMAIL, sendEmail } from "@/lib/email";
import { asLocale } from "@/lib/locale";
import { renderMeetingInvoiceEmail } from "@/lib/meetings/email";
import { MEETING_STATUSES, type MeetingStatus } from "@/lib/meetings/rules";
import { applyMeetingCredit, loadMeetingSettings, meetingById, setMeetLink, setMeetingStatus } from "@/lib/meetings/server";
import { isUuid } from "@/lib/uuid";

// Owner actions on a meeting. Every one re-checks super admin here AND in the
// RPC (set_meeting_status / apply_meeting_credit raise 'forbidden'), and the
// status ladder is forward-only in SQL, so these cannot widen the rules.
//
// The locale and tab come from hidden form fields the browser controls: both
// are pinned to known values before they reach revalidatePath.

type Tab = "upcoming" | "past";

function readForm(formData: FormData): { locale: string; tab: Tab; id: string } | null {
  const locale = asLocale(formData.get("locale"));
  const tab: Tab = formData.get("tab") === "past" ? "past" : "upcoming";
  const id = String(formData.get("id") ?? "");
  return isUuid(id) ? { locale, tab, id } : null;
}

function refresh(locale: string) {
  revalidatePath(`/${locale}/dashboard/meetings`);
}

export async function setStatusAction(formData: FormData) {
  await requireSuperAdmin(asLocale(formData.get("locale")));
  const form = readForm(formData);
  if (!form) return;

  const requested = String(formData.get("status") ?? "");
  const status = MEETING_STATUSES.find((s) => s === requested) as MeetingStatus | undefined;
  if (!status) return;

  await setMeetingStatus(form.id, status, String(formData.get("note") ?? "") || null);
  refresh(form.locale);
}

export async function setMeetLinkAction(formData: FormData) {
  await requireSuperAdmin(asLocale(formData.get("locale")));
  const form = readForm(formData);
  if (!form) return;

  const raw = String(formData.get("link") ?? "").trim();
  // Only an https link, so nothing odd ends up in a client's WhatsApp message.
  let link: string | null = null;
  if (raw) {
    try {
      const u = new URL(raw);
      if (u.protocol !== "https:") return;
      link = u.toString().slice(0, 500);
    } catch {
      return;
    }
  }
  await setMeetLink(form.id, link);
  refresh(form.locale);
}

/**
 * "Send invoice": the owner's choice AFTER the meeting. It marks the meeting
 * invoiced and e-mails the client the amount with the Fawran alias and the
 * bank details — the one place the IBAN appears. The WhatsApp text the owner
 * taps is a link on the page, and carries no IBAN.
 */
export async function sendInvoiceAction(formData: FormData) {
  await requireSuperAdmin(asLocale(formData.get("locale")));
  const form = readForm(formData);
  if (!form) return;

  const booking = await meetingById(form.id);
  if (!booking || booking.status !== "done") return;

  const moved = await setMeetingStatus(form.id, "invoiced");
  if (!moved.ok) return;

  const settings = await loadMeetingSettings();
  const mail = renderMeetingInvoiceEmail({
    booking: {
      starts_at: booking.starts_at,
      mode: booking.mode,
      name: booking.name,
      phone: booking.phone,
      email: booking.email,
      locale: booking.locale,
      invoice_qar: Number(booking.invoice_qar),
    },
    settings,
    manageUrl: "",
  });
  try {
    const to = booking.email ? [booking.email] : [OWNER_EMAIL];
    const sent = await sendEmail({ to, subject: mail.subject, html: mail.html, text: mail.text });
    if (!sent) console.warn("[meetings] invoice email not sent (RESEND_API_KEY missing or Resend error)");
  } catch (err) {
    console.error("[meetings] invoice email failed:", err);
  }
  refresh(form.locale);
}

/** Records the QAR 150 credit against one order. Changes no order total. */
export async function applyCreditAction(formData: FormData) {
  await requireSuperAdmin(asLocale(formData.get("locale")));
  const form = readForm(formData);
  if (!form) return;

  const orderId = String(formData.get("orderId") ?? "");
  if (!isUuid(orderId)) return;

  await applyMeetingCredit(form.id, orderId);
  revalidatePath(`/${form.locale}/dashboard/store/orders/${orderId}`);
  refresh(form.locale);
}
