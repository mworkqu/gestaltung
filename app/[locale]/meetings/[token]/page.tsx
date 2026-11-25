import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { MessagesScope } from "@/components/i18n/messages-scope";
import { MeetingManage, type MeetingView } from "@/components/meetings/manage";
import { getContactPhone } from "@/lib/contact-phone-server";
import { whatsappLink } from "@/lib/contact-phone";
import { asLocale } from "@/lib/locale";
import { companyLine, meetingLines, modeLabel, modeLine } from "@/lib/meetings/copy";
import { canChangeOnline } from "@/lib/meetings/rules";
import { freeMeetingSlots, loadMeetingSettings, meetingByToken } from "@/lib/meetings/server";
import { slotLabel } from "@/lib/meetings/slots";

// The client's private link for one meeting: never indexed, never in the
// sitemap. The token is the authorisation; only its sha256 is stored.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

const TOKEN_RE = /^[A-Za-z0-9_-]{20,200}$/;

const STATUS_KEY = {
  booked: "statusBooked",
  cancelled: "statusCancelled",
  done: "statusDone",
  no_show: "statusNoShow",
  invoiced: "statusInvoiced",
  paid: "statusPaid",
} as const;

export default async function MeetingPage({ params }: { params: Promise<{ locale: string; token: string }> }) {
  const { locale: rawLocale, token } = await params;
  setRequestLocale(rawLocale);
  const locale = asLocale(rawLocale);
  const t = await getTranslations({ locale, namespace: "Meetings" });

  const booking = TOKEN_RE.test(token) ? await meetingByToken(token) : null;

  if (!booking) {
    return (
      <MessagesScope scope="meetings">
        <main className="container flex min-h-[60vh] items-center py-10">
          <div className="neu mx-auto w-full max-w-lg space-y-3 p-5 sm:p-8" data-testid="meeting-card" data-state="notFound">
            <h1 className="text-xl font-black tracking-tight text-heading">{t("notFound")}</h1>
            <p className="text-xs text-faint">{companyLine(locale)}</p>
          </div>
        </main>
      </MessagesScope>
    );
  }

  const settings = await loadMeetingSettings();
  const canChange = canChangeOnline({ startsAt: booking.starts_at, status: booking.status }, settings, Date.now());
  // Only fetch alternatives when the client may actually move it.
  const slots = canChange ? await freeMeetingSlots() : [];
  const contact = await getContactPhone();

  const view: MeetingView = {
    token,
    label: slotLabel(booking.starts_at, locale, settings),
    statusKey: STATUS_KEY[booking.status] ?? "statusBooked",
    mode: booking.mode,
    modeLabel: modeLabel(booking.mode, locale),
    modeDetail: modeLine(booking.mode, locale),
    topic: booking.topic,
    meetLink: booking.mode === "online" ? booking.meet_link : null,
    lines: meetingLines(settings, locale),
    company: companyLine(locale),
    canChange,
    slots: slots
      .filter((s) => s !== booking.starts_at)
      .map((s) => ({ value: s, label: slotLabel(s, locale, settings) })),
    whatsappUrl: whatsappLink(contact, t("title")),
  };

  return (
    <MessagesScope scope="meetings">
      <main className="container flex min-h-[60vh] items-center py-10">
        <MeetingManage view={view} />
      </main>
    </MessagesScope>
  );
}
