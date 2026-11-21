"use client";

// TEST-ONLY: the meeting manage card in both states plus the real booking
// form, with no Supabase and no session. The booking form's only network call
// is GET /api/meetings/slots, which the e2e spec intercepts, so nothing here
// can write.

import { MeetingBooking } from "./booking";
import { MeetingManage, type MeetingView } from "./manage";

const BASE: Omit<MeetingView, "canChange" | "slots"> = {
  token: "e2e-fixture-token-aaaaaaaaaaaaaaaa",
  label: "Mon 23 Nov · 4:00 pm",
  statusKey: "statusBooked",
  mode: "online",
  modeLabel: "Online",
  modeDetail: "Online: we send the meeting link on WhatsApp before the meeting.",
  topic: "I want to talk about the pump",
  meetLink: null,
  lines: [
    "1 hour · QAR 150",
    "Invoiced after the meeting, only if you are happy.",
    "Free to move or cancel up to 24 hours before. Counts towards an order within 30 days.",
  ],
  company: "Gestaltung for Trading and Services W.L.L · C.R. 236988",
  whatsappUrl: "https://wa.me/97433664265",
};

export function MeetingsFixture() {
  return (
    <>
      {/* Inside the free-change window: Move and Cancel are offered. */}
      <MeetingManage
        view={{
          ...BASE,
          canChange: true,
          slots: [
            { value: "2026-11-25T13:00:00.000Z", label: "Wed 25 Nov · 4:00 pm" },
            { value: "2026-11-25T14:00:00.000Z", label: "Wed 25 Nov · 5:00 pm" },
          ],
        }}
      />
      {/* Past the window: the WhatsApp line instead of the buttons. */}
      <MeetingManage view={{ ...BASE, mode: "studio", modeLabel: "At the studio", canChange: false, slots: [] }} />
      <MeetingBooking />
    </>
  );
}
