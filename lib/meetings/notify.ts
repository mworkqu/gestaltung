/**
 * What happens after a meeting is booked from the WEBSITE: the lead row and the
 * two e-mails. Server-only.
 *
 * The MCP tool does the same three steps through its injected deps
 * (lib/plugin/server/register.ts) so its tests can capture them without a
 * database. Both paths build their text with the same pure renderers in
 * ./email.ts and ./copy.ts, so the wording cannot drift — only the plumbing
 * differs.
 *
 * Every step is best-effort and logged: a booking is already saved in the
 * database before any of this runs, so a missing e-mail key must never lose it.
 */
import "server-only";

import { OWNER_EMAIL, sendEmail } from "@/lib/email";
import { createServiceClient } from "@/lib/supabase/service";

import { meetingLeadMessage, renderMeetingClientEmail, renderMeetingOwnerEmail, type MeetingMailInput } from "./email";

export type NotifyResult = { lead: boolean; ownerEmail: boolean; clientEmail: boolean };

export async function notifyBooking(input: MeetingMailInput): Promise<NotifyResult> {
  const out: NotifyResult = { lead: false, ownerEmail: false, clientEmail: false };
  const { booking } = input;

  try {
    const svc = createServiceClient();
    if (svc) {
      const { error } = await svc.from("inquiries").insert({
        name: booking.name,
        phone: booking.phone,
        email: booking.email ?? null,
        locale: booking.locale ?? "en",
        message: meetingLeadMessage(input),
        status: "new",
      });
      if (error) throw error;
      out.lead = true;
    }
  } catch (err) {
    console.error("[meetings] lead not saved:", err);
  }

  try {
    const mail = renderMeetingOwnerEmail(input);
    out.ownerEmail = await sendEmail({ to: [OWNER_EMAIL], subject: mail.subject, html: mail.html, text: mail.text });
    if (!out.ownerEmail) console.warn("[meetings] owner email not sent (RESEND_API_KEY missing or Resend error)");
  } catch (err) {
    console.error("[meetings] owner email failed:", err);
  }

  if (booking.email) {
    try {
      const mail = renderMeetingClientEmail(input);
      out.clientEmail = await sendEmail({ to: [booking.email], subject: mail.subject, html: mail.html, text: mail.text });
    } catch (err) {
      console.error("[meetings] client email failed:", err);
    }
  }

  return out;
}
