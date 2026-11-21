"use server";

// Move and cancel, authorised by the manage token itself (only its sha256 is
// stored). No sign-in: the person who has the link is the person who booked.
// The database re-checks the 24-hour window and the slot, so these actions
// cannot widen the rules.

import { cancelMeeting, freeMeetingSlots, moveMeeting } from "@/lib/meetings/server";

export type MeetingActionResult = { ok: true; startsAt?: string } | { ok: false; error: string };

const TOKEN_RE = /^[A-Za-z0-9_-]{20,200}$/;

export async function cancelMeetingAction(token: string): Promise<MeetingActionResult> {
  if (!TOKEN_RE.test(token)) return { ok: false, error: "bad_token" };
  const r = await cancelMeeting(token);
  return r.ok ? { ok: true } : { ok: false, error: r.reason };
}

export async function moveMeetingAction(token: string, startsAt: string): Promise<MeetingActionResult> {
  if (!TOKEN_RE.test(token)) return { ok: false, error: "bad_token" };
  const when = new Date(startsAt);
  if (Number.isNaN(when.getTime())) return { ok: false, error: "bad_slot" };
  const r = await moveMeeting(token, when.toISOString());
  return r.ok ? { ok: true, startsAt: r.startsAt } : { ok: false, error: r.reason };
}

/** The times the client may move to (same list the booking UI shows). */
export async function meetingSlotsAction(): Promise<string[]> {
  return freeMeetingSlots();
}
