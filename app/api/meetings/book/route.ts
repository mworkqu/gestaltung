import { z } from "zod";

import { jsonError, jsonOk } from "@/lib/http";
import { leadAllowed } from "@/lib/leads/gate";
import { asLocale } from "@/lib/locale";
import { notifyBooking } from "@/lib/meetings/notify";
import { bookMeeting, loadMeetingSettings } from "@/lib/meetings/server";
import { isValidPhone, normalizePhone } from "@/lib/phone";
import { isPlausibleEmail } from "@/lib/email-address";
import { readTurnstileToken } from "@/lib/turnstile";

// Books a meeting from the website (components/meetings/booking.tsx). Same
// rules, same database RPC and the same Turnstile gate as /api/store-lead; the
// database re-checks the slot, so two visitors cannot take the same hour.
//
// Guests may book: no sign-in is required (owner decision). Before migration
// 0113 runs this answers 503 not_set_up and the UI says so.

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  starts_at: z.string().trim().min(10).max(40),
  mode: z.enum(["online", "studio"]),
  name: z.string().trim().min(1).max(60),
  phone: z.string().trim().min(6).max(20),
  email: z.string().trim().max(160).optional(),
  topic: z.string().trim().max(400).optional(),
  locale: z.enum(["en", "ar"]).optional(),
  turnstileToken: z.string().max(4096).optional(),
});

/** The booking errors the UI knows how to phrase, with the status to answer. */
const STATUS: Record<string, number> = {
  slot_taken: 409,
  too_soon: 400,
  bad_slot: 400,
  too_many: 429,
  not_set_up: 503,
  failed: 500,
};

export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError("bad_request", 400);
  }

  const token = readTurnstileToken(request.headers) ?? readTurnstileToken(raw as Record<string, unknown> | null);
  if (!(await leadAllowed(request, token))) return jsonError("captcha_failed", 403);

  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) return jsonError("bad_request", 400);
  const body = parsed.data;

  if (!isValidPhone(body.phone)) return jsonError("bad_phone", 400);
  const email = body.email?.trim() || "";
  if (email && !isPlausibleEmail(email)) return jsonError("bad_email", 400);

  const startsAt = new Date(body.starts_at);
  if (Number.isNaN(startsAt.getTime())) return jsonError("bad_slot", 400);

  const locale = asLocale(body.locale);
  const siteUrl = new URL(request.url).origin;
  const settings = await loadMeetingSettings();

  const { randomBytes } = await import("node:crypto");
  const manageToken = randomBytes(32).toString("base64url");

  const booked = await bookMeeting(
    {
      startsAt: startsAt.toISOString(),
      mode: body.mode,
      name: body.name,
      phone: normalizePhone(body.phone),
      email: email || null,
      locale,
      topic: body.topic?.trim() || null,
      source: "website",
    },
    siteUrl,
    manageToken,
  );
  if (!booked.ok) return jsonError(booked.error, STATUS[booked.error] ?? 500);

  // The meeting is saved; the lead and the e-mails are best-effort from here.
  await notifyBooking({
    booking: {
      starts_at: booked.booking.starts_at,
      mode: booked.booking.mode,
      name: booked.booking.name,
      phone: booked.booking.phone,
      email: booked.booking.email,
      locale,
      topic: booked.booking.topic,
      source: "website",
      invoice_qar: Number(booked.booking.invoice_qar),
    },
    settings,
    manageUrl: booked.manageUrl,
    siteUrl,
  });

  return jsonOk({
    ok: true,
    starts_at: booked.booking.starts_at,
    mode: booked.booking.mode,
    price_qar: Number(booked.booking.invoice_qar),
    manage_link: booked.manageUrl,
  });
}
