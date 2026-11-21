import { jsonError, jsonOk } from "@/lib/http";
import { asLocale } from "@/lib/locale";
import { companyLine, meetingLines, modeLabel, modeLine } from "@/lib/meetings/copy";
import { freeMeetingSlots, loadMeetingSettings } from "@/lib/meetings/server";
import { slotOptions } from "@/lib/meetings/slots";

// Free meeting times for the website booking UI (components/meetings/booking.tsx).
// Read-only and personal-data-free: start times and labels only, never a name
// or a phone number. Before migration 0113 runs it answers an empty list, so
// the UI shows "no free times" instead of breaking.

export const dynamic = "force-dynamic";

const MAX_DAYS = 21;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const locale = asLocale(url.searchParams.get("locale"));

  const raw = Number(url.searchParams.get("days"));
  const days = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), MAX_DAYS) : MAX_DAYS;

  try {
    const settings = await loadMeetingSettings();
    const slots = slotOptions(await freeMeetingSlots(days), settings);
    return jsonOk(
      {
        slots,
        price_qar: settings.price_qar,
        lines: meetingLines(settings, locale),
        modes: settings.modes.map((m) => ({ mode: m, label: modeLabel(m, locale), detail: modeLine(m, locale) })),
        company: companyLine(locale),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    console.error("[meetings] slots route failed:", err);
    return jsonError("failed", 500);
  }
}
