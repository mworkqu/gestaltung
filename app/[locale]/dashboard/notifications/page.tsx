import { getTranslations, setRequestLocale } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { NotificationTestForm } from "@/components/admin/notification-test-form";
import { NOTIFICATION_KINDS } from "@/lib/email/templates";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

// Notification log (Phase I): the notification_outbox rows the cron drainer
// sends, newest first, plus a "send test to me" form. super_admin only (layout).
// The table exists after migration 0046; before that we show a notice.

export const dynamic = "force-dynamic";

const STATUSES = ["queued", "sent", "failed", "skipped"] as const;
const LIMIT = 200;

type Row = {
  id: string;
  user_id: string | null;
  kind: string;
  status: string;
  email: string | null;
  attempts: number;
  last_error: string | null;
  created_at: string;
  sent_at: string | null;
};

const STATUS_STYLE: Record<string, string> = {
  queued: "bg-amber-100 text-amber-800",
  sent: "bg-emerald-100 text-emerald-800",
  failed: "bg-red-100 text-red-800",
  skipped: "bg-slate-200 text-slate-700",
};

export default async function NotificationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { status } = await searchParams;
  const t = await getTranslations("Notifications");
  const isRtl = locale === "ar";
  const mono = (extra = "") => cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);
  const date = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString(isRtl ? "ar-QA-u-nu-latn" : "en-GB", { dateStyle: "medium", timeStyle: "short" }) : "—";

  const filter = (STATUSES as readonly string[]).includes(status ?? "") ? status! : "all";

  const supabase = await createClient();
  let query = supabase
    .from("notification_outbox")
    .select("id, user_id, kind, status, email, attempts, last_error, created_at, sent_at")
    .order("created_at", { ascending: false })
    .limit(LIMIT);
  if (filter !== "all") query = query.eq("status", filter);
  const { data, error } = await query;
  const notReady = !!error;
  const rows = (data ?? []) as Row[];

  const th = "px-3 pb-2 text-start font-medium";
  const td = "px-3 py-2 align-top";
  const tab = (value: string) =>
    cn(
      "rounded-lg px-3 py-1.5 text-xs font-semibold",
      filter === value ? "bg-cobalt text-white" : "bg-surface text-mutedtext shadow-neu-inset hover:text-heading"
    );

  return (
    <div className="space-y-6">
      <div>
        <p className={mono("text-[10px] text-azure")}>{t("kicker")}</p>
        <h1 className="mt-2 text-2xl font-extrabold text-heading">{t("title")}</h1>
        <p className="mt-1 max-w-[70ch] text-sm text-mutedtext">{t("intro")}</p>
      </div>

      <NotificationTestForm kinds={[...NOTIFICATION_KINDS]} defaultLocale={locale === "ar" ? "ar" : "en"} />

      {notReady && <p className="text-sm font-medium text-destructive">{t("needsMigration")}</p>}

      {!notReady && (
        <>
          <nav className="flex flex-wrap items-center gap-2" aria-label={t("filterLabel")}>
            <span className="text-[11px] text-mutedtext">{t("filterLabel")}</span>
            <Link href="/dashboard/notifications" className={tab("all")}>
              {t("filter_all")}
            </Link>
            {STATUSES.map((s) => (
              <Link key={s} href={{ pathname: "/dashboard/notifications", query: { status: s } }} className={tab(s)}>
                {t(`status_${s}`)}
              </Link>
            ))}
          </nav>

          <div className="neu overflow-x-auto p-4">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-faint">
                  <th className={th}>{t("colStatus")}</th>
                  <th className={th}>{t("colKind")}</th>
                  <th className={th}>{t("colUser")}</th>
                  <th className={th}>{t("colEmail")}</th>
                  <th className={cn(th, "text-end")}>{t("colAttempts")}</th>
                  <th className={th}>{t("colError")}</th>
                  <th className={th}>{t("colCreated")}</th>
                  <th className={th}>{t("colSent")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-borderstrong/40">
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className={td}>
                      <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", STATUS_STYLE[r.status] ?? "bg-slate-200 text-slate-700")}>
                        {(STATUSES as readonly string[]).includes(r.status) ? t(`status_${r.status as (typeof STATUSES)[number]}`) : r.status}
                      </span>
                    </td>
                    <td className={td}>
                      {(NOTIFICATION_KINDS as readonly string[]).includes(r.kind) ? t(`kind_${r.kind as (typeof NOTIFICATION_KINDS)[number]}`) : r.kind}
                    </td>
                    <td className={cn(td, "font-mono text-[12px] text-mutedtext")} dir="ltr" title={r.user_id ?? undefined}>
                      {r.user_id ? r.user_id.slice(0, 8) : "—"}
                    </td>
                    <td className={cn(td, "break-all text-[12.5px]")} dir="ltr">
                      {r.email ?? "—"}
                    </td>
                    <td className={cn(td, "text-end tabular-nums")}>{r.attempts}</td>
                    <td className={cn(td, "max-w-[260px] break-words text-[12px] text-destructive")}>{r.last_error ?? ""}</td>
                    <td className={cn(td, "whitespace-nowrap text-[12px] text-mutedtext")}>{date(r.created_at)}</td>
                    <td className={cn(td, "whitespace-nowrap text-[12px] text-mutedtext")}>{date(r.sent_at)}</td>
                  </tr>
                ))}
                {!rows.length && (
                  <tr>
                    <td colSpan={8} className="px-3 py-4 text-center text-mutedtext">
                      {t("empty")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {rows.length >= LIMIT && <p className="text-[11.5px] text-mutedtext">{t("limitNote", { n: LIMIT })}</p>}
        </>
      )}
    </div>
  );
}
