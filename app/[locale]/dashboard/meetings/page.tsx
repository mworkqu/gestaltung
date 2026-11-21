import { CalendarClock, MessageCircle } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { requireSuperAdmin } from "@/lib/auth/guards";
import { formatQar } from "@/lib/format/money";
import { asLocale } from "@/lib/locale";
import { invoiceWhatsappText, modeLabel } from "@/lib/meetings/copy";
import { nextStatuses, type MeetingStatus } from "@/lib/meetings/rules";
import { listMeetings, loadMeetingSettings, type MeetingBooking } from "@/lib/meetings/server";
import { slotLabel } from "@/lib/meetings/slots";
import { formatPhoneDisplay, toWhatsAppDigits } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { sendInvoiceAction, setMeetLinkAction, setStatusAction } from "./actions";

// Dashboard → Sell → Meetings (0113). Paid engineer meetings: upcoming and
// past, with the owner's actions. super_admin only, like Leads and Reviews.
// Before 0113 runs, listMeetings() answers null and the page says so.
export const dynamic = "force-dynamic";

const STATUS_KEY: Record<MeetingStatus, string> = {
  booked: "statusBooked",
  cancelled: "statusCancelled",
  done: "statusDone",
  no_show: "statusNoShow",
  invoiced: "statusInvoiced",
  paid: "statusPaid",
};

const STATUS_STYLE: Record<MeetingStatus, string> = {
  booked: "bg-cobalt/10 text-cobalt",
  done: "bg-emerald-500/10 text-emerald-700",
  invoiced: "bg-amber-500/10 text-amber-700",
  paid: "bg-emerald-600/15 text-emerald-800",
  cancelled: "bg-black/5 text-mutedtext",
  no_show: "bg-destructive/10 text-destructive",
};

const button =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-cobalt px-4 text-sm font-semibold text-white transition-colors hover:bg-cobalt-hover active:scale-[0.98]";
const ghost =
  "inline-flex min-h-11 items-center gap-1.5 rounded-full bg-panel px-4 text-sm font-semibold text-body shadow-neu-sm transition-colors hover:text-cobalt";
const field =
  "min-h-11 w-full rounded-xl border border-white/60 bg-panel px-3 py-2 text-sm text-heading shadow-neu-inset outline-none focus:ring-2 focus:ring-cobalt/60";

export default async function MeetingsAdminPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { locale: rawLocale } = await params;
  setRequestLocale(rawLocale);
  const locale = asLocale(rawLocale);
  await requireSuperAdmin(locale);

  const { tab: rawTab } = await searchParams;
  const tab = rawTab === "past" ? "past" : "upcoming";

  const t = await getTranslations({ locale, namespace: "DashboardMeetings" });
  const settings = await loadMeetingSettings();
  const rows = await listMeetings({ past: tab === "past" });

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight text-heading">
          <CalendarClock className="h-6 w-6 text-cobalt" strokeWidth={1.5} aria-hidden />
          {t("title")}
        </h1>
        <p className="max-w-2xl text-sm text-body">{t("intro")}</p>
      </header>

      <nav className="flex gap-2" aria-label={t("title")}>
        {(["upcoming", "past"] as const).map((key) => (
          <Link
            key={key}
            href={key === "upcoming" ? "/dashboard/meetings" : "/dashboard/meetings?tab=past"}
            className={cn(
              "inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold transition-colors",
              tab === key ? "bg-cobalt text-white" : "bg-panel text-body shadow-neu-sm hover:text-cobalt",
            )}
            aria-current={tab === key ? "page" : undefined}
          >
            {t(key)}
          </Link>
        ))}
      </nav>

      {rows === null ? (
        <p className="neu p-5 text-sm text-body" data-testid="meetings-not-ready">
          {t("notReady")}
        </p>
      ) : rows.length === 0 ? (
        <p className="neu p-5 text-sm text-body" data-testid="meetings-empty">
          {t("none")}
        </p>
      ) : (
        <ul className="space-y-4" data-testid="meetings-list">
          {rows.map((m) => (
            <MeetingRow key={m.id} m={m} locale={locale} tab={tab} t={t} settings={settings} />
          ))}
        </ul>
      )}
    </div>
  );
}

function MeetingRow({
  m,
  locale,
  tab,
  t,
  settings,
}: {
  m: MeetingBooking;
  locale: "en" | "ar";
  tab: "upcoming" | "past";
  t: (key: string, values?: Record<string, string>) => string;
  settings: Awaited<ReturnType<typeof loadMeetingSettings>>;
}) {
  const wa = toWhatsAppDigits(m.phone);
  const next = nextStatuses(m.status);
  const hidden = (
    <>
      <input type="hidden" name="id" value={m.id} />
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="tab" value={tab} />
    </>
  );

  return (
    <li className="neu space-y-3 p-4 sm:p-5" data-testid="meeting-row" data-status={m.status}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-black text-heading">{slotLabel(m.starts_at, locale, settings)}</span>
        <span className="text-xs text-mutedtext">{modeLabel(m.mode, locale)}</span>
        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", STATUS_STYLE[m.status])}>{t(STATUS_KEY[m.status])}</span>
        <span className="text-[11px] text-faint">
          {m.chat_source === "chatgpt"
            ? t("sourceChatgpt")
            : m.chat_source === "claude"
              ? t("sourceClaude")
              : m.source === "plugin"
                ? t("sourcePlugin")
                : t("sourceWebsite")}
        </span>
        {m.is_test && <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-700">{t("testRow")}</span>}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <p className="text-sm text-heading">
          <span className="text-xs font-semibold text-mutedtext">{t("who")} </span>
          {m.name}
          <span dir="ltr" className="ms-2 text-body">
            {formatPhoneDisplay(m.phone)}
          </span>
        </p>
        {m.email && (
          <p className="text-sm text-body" dir="ltr">
            {m.email}
          </p>
        )}
      </div>

      {m.topic && (
        <p className="text-sm text-body">
          <span className="text-xs font-semibold text-mutedtext">{t("topic")} </span>
          {m.topic}
        </p>
      )}

      {(m.project_id || m.handoff_id) && (
        <p className="text-sm">
          {m.project_id ? (
            <Link href={`/projects/${m.project_id}/studio`} className="font-semibold text-cobalt underline-offset-2 hover:underline">
              {t("openProject")}
            </Link>
          ) : (
            <span className="text-mutedtext">{t("openHandoff")}</span>
          )}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {wa && (
          <a href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer" className={ghost}>
            <MessageCircle className="h-4 w-4" strokeWidth={1.5} aria-hidden />
            {t("whatsapp")}
          </a>
        )}

        {next
          .filter((s) => s !== "invoiced")
          .map((s) => (
            <form key={s} action={setStatusAction}>
              {hidden}
              <input type="hidden" name="status" value={s} />
              <button type="submit" className={ghost} data-testid={`meeting-${s}`}>
                {s === "done" ? t("markDone") : s === "no_show" ? t("markNoShow") : s === "paid" ? t("markPaid") : t(STATUS_KEY[s])}
              </button>
            </form>
          ))}

        {/* The owner's choice, only after the meeting happened. */}
        {m.status === "done" && (
          <form action={sendInvoiceAction}>
            {hidden}
            <button type="submit" className={button} data-testid="meeting-invoice">
              {t("sendInvoice")} · {formatQar(Number(m.invoice_qar), locale)}
            </button>
          </form>
        )}

        {m.status === "invoiced" && wa && (
          <a
            href={`https://wa.me/${wa}?text=${encodeURIComponent(invoiceWhatsappText(settings, m.locale, Number(m.invoice_qar)))}`}
            target="_blank"
            rel="noopener noreferrer"
            className={ghost}
          >
            {t("invoiceWhatsapp")}
          </a>
        )}
      </div>

      {m.status === "done" && <p className="text-xs text-faint">{t("sendInvoiceHint")}</p>}
      {m.status === "invoiced" && <p className="text-xs text-faint">{t("ibanNote")}</p>}

      {/* Online meetings need the Meet link the owner sends on WhatsApp. */}
      {m.mode === "online" && m.status === "booked" && (
        <form action={setMeetLinkAction} className="flex flex-wrap items-end gap-2">
          {hidden}
          <label className="min-w-0 flex-1 space-y-1">
            <span className="text-xs font-semibold text-mutedtext">{t("meetLinkLabel")}</span>
            <input
              type="url"
              name="link"
              defaultValue={m.meet_link ?? ""}
              placeholder="https://meet.google.com/..."
              dir="ltr"
              className={field}
              data-testid="meeting-link-input"
            />
          </label>
          <button type="submit" className={ghost}>
            {t("meetLinkSave")}
          </button>
          <p className="w-full text-xs text-faint">{t("meetLinkHint")}</p>
        </form>
      )}
    </li>
  );
}
