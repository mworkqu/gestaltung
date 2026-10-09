import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Star } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { getSessionContext } from "@/lib/auth/get-session";
import { createClient } from "@/lib/supabase/server";
import {
  REVIEW_STATUSES,
  countByStatus,
  displayName,
  formatReviewDate,
  parseAdminReviews,
  type ReviewStatus,
} from "@/lib/reviews/reviews";
import { cn } from "@/lib/utils";
import { setReviewStatus } from "./actions";

// Review moderation (P4-03, migration 0058): ratings and one-line comments from
// delivered orders. Nothing is public until approved here; any later change by
// the customer puts it back to Pending. super_admin only (RLS: select/update
// for super admin only; the page redirects everyone else like Leads does).
export const dynamic = "force-dynamic";

const LIMIT = 500;

export default async function ReviewsAdminPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ status?: string; err?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);

  const session = await getSessionContext();
  if (!session) redirect(`/${locale}/sign-in`);
  if (session.profile.role !== "super_admin") redirect(`/${locale}/dashboard`);

  const t = await getTranslations("Reviews");
  const isRtl = locale === "ar";
  const mono = (extra = "") => cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);
  const tab: ReviewStatus = REVIEW_STATUSES.find((s) => s === sp.status) ?? "pending";

  // Before 0058 the table does not exist: PostgREST answers with an error and we
  // show the "run the migration" note instead of an empty table.
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("reviews")
    .select("id, order_id, score, comment, locale, status, skus, first_name, created_at")
    .order("created_at", { ascending: false })
    .limit(LIMIT);
  const notReady = !!error;
  if (error) console.warn(`[reviews] list failed: ${error.message}`);
  const all = notReady ? [] : parseAdminReviews(data);
  const counts = countByStatus(all);
  const rows = all.filter((r) => r.status === tab);

  const th = "px-3 pb-2 text-start font-medium";
  const td = "px-3 py-2 align-top";
  const btn = "rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors max-md:min-h-11";

  const act = (id: string, status: ReviewStatus, label: string, tone: string) => (
    <form action={setReviewStatus}>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="tab" value={tab} />
      <input type="hidden" name="status" value={status} />
      <button type="submit" className={cn(btn, tone)}>
        {label}
      </button>
    </form>
  );

  return (
    <div className="space-y-6">
      <div>
        <p className={mono("text-[10px] text-azure")}>{t("adminKicker")}</p>
        <h1 className="mt-2 text-2xl font-extrabold text-heading">{t("adminTitle")}</h1>
        <p className="mt-1 max-w-[70ch] text-sm text-mutedtext">{t("adminIntro")}</p>
      </div>

      {notReady && <p className="text-sm font-medium text-destructive">{t("needsMigration")}</p>}
      {sp.err && <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{t("updateFailed")}</p>}

      <nav aria-label={t("adminTitle")} className="flex flex-wrap gap-2">
        {REVIEW_STATUSES.map((s) => (
          <Link
            key={s}
            href={{ pathname: "/dashboard/reviews", query: { status: s } }}
            aria-current={s === tab ? "page" : undefined}
            className={cn(
              "rounded-full px-3.5 py-1.5 text-xs font-semibold shadow-neu-sm max-md:inline-flex max-md:min-h-11 max-md:items-center",
              s === tab ? "bg-cobalt text-white" : "bg-panel text-mutedtext hover:text-cobalt",
            )}
          >
            {t(`tab_${s}`)} ({counts[s]})
          </Link>
        ))}
      </nav>

      <div className="neu overflow-x-auto p-4">
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-faint">
              <th className={th}>{t("colDate")}</th>
              <th className={th}>{t("colScore")}</th>
              <th className={th}>{t("colComment")}</th>
              <th className={th}>{t("colName")}</th>
              <th className={th}>{t("colLocale")}</th>
              <th className={th}>{t("colSkus")}</th>
              <th className={th}>{t("colOrder")}</th>
              <th className={th} />
            </tr>
          </thead>
          <tbody className="divide-y divide-borderstrong/40">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className={cn(td, "whitespace-nowrap text-[12px] text-mutedtext")}>
                  {formatReviewDate(r.createdAt, locale)}
                </td>
                <td className={cn(td, "whitespace-nowrap")}>
                  <span className="inline-flex items-center gap-1 font-semibold tabular-nums text-heading">
                    <Star className="h-3.5 w-3.5 fill-cobalt text-cobalt" aria-hidden strokeWidth={1.75} />
                    {t("scoreOf", { score: String(r.score) })}
                  </span>
                </td>
                <td className={cn(td, "max-w-[28rem] break-words text-body")} dir="auto">
                  {r.comment ?? <span className="text-faint">{t("noComment")}</span>}
                </td>
                <td className={cn(td, "text-body")}>{displayName(r.firstName, t("noName"))}</td>
                <td className={cn(td, "text-[12px] text-mutedtext")}>{t(`lang_${r.locale}`)}</td>
                <td className={cn(td, "font-mono text-[11.5px] text-mutedtext")} dir="ltr">
                  {r.skus.length ? r.skus.join(", ") : "—"}
                </td>
                <td className={td}>
                  <Link
                    href={`/dashboard/store/orders/${r.orderId}`}
                    className="font-mono text-xs font-semibold text-cobalt hover:text-cobalt-hover"
                    dir="ltr"
                  >
                    #{r.orderId.slice(0, 8)}
                  </Link>
                </td>
                <td className={td}>
                  <div className="flex flex-wrap justify-end gap-2">
                    {r.status !== "approved" &&
                      act(r.id, "approved", t("approve"), "bg-cobalt text-white hover:bg-cobalt-hover")}
                    {r.status !== "rejected" &&
                      act(
                        r.id,
                        "rejected",
                        t("reject"),
                        "border border-borderstrong bg-panel text-heading hover:text-destructive",
                      )}
                    {r.status !== "pending" &&
                      act(
                        r.id,
                        "pending",
                        t("backToPending"),
                        "border border-borderstrong bg-panel text-mutedtext hover:text-heading",
                      )}
                  </div>
                </td>
              </tr>
            ))}
            {!rows.length && !notReady && (
              <tr>
                <td colSpan={8} className="px-3 py-4 text-center text-mutedtext">
                  {t("empty")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {all.length >= LIMIT && <p className="text-xs text-mutedtext">{t("limitNote", { n: String(LIMIT) })}</p>}
    </div>
  );
}
