import { getTranslations, setRequestLocale } from "next-intl/server";

import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { needsPaymentsMigration, qarFormatter, type RevenueRow } from "../ai-costs/format";
import { expirePass, reviewPayment } from "./actions";
import { requireSuperAdmin } from "@/lib/auth/guards";
import { intlTag, asLocale } from "@/lib/locale";
import { dayFormatter, timeFormatter } from "@/lib/format/date";
import { BUCKETS } from "@/lib/storage/paths";

// Payments admin (owner, 2026-10-18): the review queue for Fawran proofs the
// automatic check could not settle, an audit list of the auto-approved ones
// (spot checks) and the active Maker Passes. Tables + RPCs are migration 0089.

export const dynamic = "force-dynamic";

type Verdict = { amountQar?: number | null; recipient?: string; date?: string; confidence?: number } | null;

type PaymentRow = {
  id: string;
  user_id: string;
  product: string;
  amount_qar: number | string;
  reference_code: string;
  transfer_ref: string | null;
  status: string;
  auto_approved: boolean;
  proof_path: string | null;
  verdict: Verdict;
  review_reasons: string[] | null;
  note: string | null;
  reviewed_at: string | null;
  is_test: boolean;
  created_at: string;
};

type PassRow = { user_id: string; active_until: string; started_at: string };

const VIEWS = ["review", "auto", "all"] as const;
type View = (typeof VIEWS)[number];
const STATUSES = ["awaiting_proof", "verifying", "approved", "needs_review", "rejected", "revoked", "cancelled"];
const CAN_APPROVE = ["verifying", "needs_review", "rejected", "awaiting_proof"];
const CAN_REJECT = ["verifying", "needs_review", "awaiting_proof"];

export default async function PaymentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ view?: string; err?: string; done?: string }>;
}) {
  const { locale } = await params;
  await requireSuperAdmin(locale);
  const sp = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("AdminPayments");
  const view: View = (VIEWS as readonly string[]).includes(sp.view ?? "") ? (sp.view as View) : "review";
  const isRtl = locale === "ar";
  const mono = (extra = "") => cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);
  const loc = intlTag(asLocale(locale));
  const num = new Intl.NumberFormat(loc);
  const qar = qarFormatter(locale);
  const timeFmt = timeFormatter(asLocale(locale));
  const dayFmt = dayFormatter(asLocale(locale));

  const supabase = await createClient();
  let q = supabase
    .from("payments")
    .select("id, user_id, product, amount_qar, reference_code, transfer_ref, status, auto_approved, proof_path, verdict, review_reasons, note, reviewed_at, is_test, created_at")
    .order("created_at", { ascending: false })
    .limit(300);
  if (view === "review") q = q.in("status", ["needs_review", "verifying"]);
  else if (view === "auto") q = q.eq("auto_approved", true);

  const nowIso = new Date().toISOString();
  const [listRes, approvedRes, autoRes, reviewRes, passesRes, revenueRes] = await Promise.all([
    q,
    supabase.from("payments").select("amount_qar").eq("status", "approved").eq("is_test", false),
    supabase.from("payments").select("id", { count: "exact", head: true }).eq("auto_approved", true).eq("status", "approved"),
    supabase.from("payments").select("id", { count: "exact", head: true }).in("status", ["needs_review", "verifying"]),
    supabase.from("idea_passes").select("user_id, active_until, started_at").gt("active_until", nowIso).order("active_until", { ascending: true }),
    supabase.rpc("admin_revenue_users"),
  ]);

  const errors = [listRes.error, approvedRes.error, passesRes.error, revenueRes.error];
  const migrationMissing = errors.some((e) => needsPaymentsMigration(e));
  const failed = errors.find((e) => !!e);

  const payments = (listRes.data ?? []) as PaymentRow[];
  const passes = (passesRes.data ?? []) as PassRow[];
  const revenue = new Map(((revenueRes.data ?? []) as RevenueRow[]).map((r) => [r.user_id, r]));
  const revenueTotal = (approvedRes.data ?? []).reduce((s, r) => s + Number(r.amount_qar), 0);

  // Emails for every user on screen.
  const ids = [...new Set([...payments.map((p) => p.user_id), ...passes.map((p) => p.user_id)])];
  const emailOf = new Map<string, string | null>();
  if (ids.length > 0) {
    const { data } = await supabase.from("profiles").select("id, email").in("id", ids);
    for (const r of data ?? []) emailOf.set(r.id as string, (r.email as string | null) ?? null);
  }
  const who = (id: string) => emailOf.get(id) ?? `${t("guest")} ${id.slice(0, 8)}`;

  // Proof screenshots: short-lived signed URLs (admin storage policy can read the bucket).
  const proofUrl = new Map<string, string>();
  await Promise.all(
    payments
      .filter((p) => p.proof_path)
      .map(async (p) => {
        const { data } = await supabase.storage.from(BUCKETS.paymentProofs).createSignedUrl(p.proof_path as string, 600);
        if (data?.signedUrl) proofUrl.set(p.id, data.signedUrl);
      }),
  );

  const stats: { label: string; value: string }[] = [
    { label: t("revenue"), value: qar(revenueTotal) },
    { label: t("autoCount"), value: num.format(autoRes.count ?? 0) },
    { label: t("reviewCount"), value: num.format(reviewRes.count ?? 0) },
    { label: t("activePasses"), value: num.format(passes.length) },
  ];

  const th = "pb-2 font-medium";
  const statusLabel = (s: string) => (STATUSES.includes(s) ? t(`status_${s}`) : s);
  const verdictLine = (v: Verdict) =>
    v
      ? [
          v.amountQar != null ? qar(v.amountQar) : null,
          v.recipient || null,
          v.date || null,
          typeof v.confidence === "number" ? `${Math.round(v.confidence * 100)}%` : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : "—";

  return (
    <div className="space-y-8">
      <div>
        <p className={mono("text-[10px] text-azure")}>{t("kicker")}</p>
        <h1 className="mt-2 text-2xl font-extrabold text-heading">{t("title")}</h1>
        <p className="mt-1 max-w-[70ch] text-sm text-mutedtext">{t("intro")}</p>
      </div>

      {sp.err && <p className="text-sm font-medium text-destructive">{t("actionFailed")}</p>}
      {sp.done && !sp.err && <p className="text-sm font-medium text-heading">{t("actionDone")}</p>}

      {migrationMissing ? (
        <p className="text-sm font-medium text-destructive">{t("needsMigration")}</p>
      ) : failed ? (
        <p className="text-sm font-medium text-destructive">{t("loadError")}</p>
      ) : (
        <>
          <section className="neu p-6">
            <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {stats.map((s) => (
                <div key={s.label}>
                  <dt className="text-[10px] uppercase tracking-wider text-faint">{s.label}</dt>
                  <dd className="font-mono text-lg font-bold tabular-nums text-heading">{s.value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 text-[12px] text-mutedtext">{t("revenueNote")}</p>
          </section>

          <section className="neu space-y-4 p-6">
            <nav className="flex flex-wrap gap-2" aria-label={t("title")}>
              {VIEWS.map((v) => (
                <Link
                  key={v}
                  href={`/dashboard/payments?view=${v}`}
                  className={cn(
                    "rounded-xl px-4 py-2 text-sm font-semibold",
                    v === view ? "bg-panel text-heading shadow-neu-inset" : "text-mutedtext shadow-neu-sm",
                  )}
                >
                  {t(`view_${v}`)}
                </Link>
              ))}
            </nav>
            {view === "auto" && <p className="text-[12px] text-mutedtext">{t("autoHelp")}</p>}

            {payments.length === 0 ? (
              <p className="text-sm text-mutedtext">{t("none")}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1000px] text-sm">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wider text-faint">
                      <th className={cn(th, "text-start")}>{t("date")}</th>
                      <th className={cn(th, "text-start")}>{t("user")}</th>
                      <th className={cn(th, "text-start")}>{t("product")}</th>
                      <th className={cn(th, "text-end")}>{t("amount")}</th>
                      <th className={cn(th, "ps-4 text-start")}>{t("reference")}</th>
                      <th className={cn(th, "text-start")}>{t("status")}</th>
                      <th className={cn(th, "text-start")}>{t("verdict")}</th>
                      <th className={cn(th, "text-start")}>{t("proof")}</th>
                      <th className={cn(th, "text-start")}>{t("actions")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-borderstrong/40">
                    {payments.map((p) => (
                      <tr key={p.id} className="align-top">
                        <td className="whitespace-nowrap py-2 text-[12px] text-mutedtext">{timeFmt.format(new Date(p.created_at))}</td>
                        <td className="py-2 text-heading">
                          <Link href={`/dashboard/ai-costs/${p.user_id}`} className="font-medium underline-offset-2 hover:underline">
                            <span dir="ltr">{who(p.user_id)}</span>
                          </Link>
                        </td>
                        <td className="py-2 font-mono text-[12px] text-body" dir="ltr">
                          {p.product}
                          {p.is_test ? ` (${t("test")})` : ""}
                        </td>
                        <td className="py-2 text-end font-mono tabular-nums text-heading">{qar(Number(p.amount_qar))}</td>
                        <td className="py-2 ps-4 font-mono text-[11px] text-body" dir="ltr">
                          {p.reference_code}
                          {p.transfer_ref && <span className="block text-faint">{p.transfer_ref}</span>}
                        </td>
                        <td className="py-2 text-[12px]">
                          <span className="font-medium text-heading">{statusLabel(p.status)}</span>
                          {p.auto_approved && (
                            <span className="block text-mutedtext">
                              {t("auto")} · {p.reviewed_at ? t("checked") : t("notChecked")}
                            </span>
                          )}
                          {p.review_reasons && p.review_reasons.length > 0 && (
                            <span className="block font-mono text-[10px] text-destructive" dir="ltr">
                              {p.review_reasons.join(", ")}
                            </span>
                          )}
                          {p.note && <span className="block text-mutedtext">{p.note}</span>}
                        </td>
                        <td className="max-w-[220px] py-2 text-[11px] text-mutedtext" dir="ltr">
                          {verdictLine(p.verdict)}
                        </td>
                        <td className="py-2">
                          {proofUrl.has(p.id) ? (
                            <a href={proofUrl.get(p.id)} target="_blank" rel="noopener noreferrer" className="text-[12px] text-azure underline">
                              {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, admin only */}
                              <img src={proofUrl.get(p.id)} alt={t("proof")} loading="lazy" className="h-14 w-10 rounded-md object-cover object-top shadow-neu-sm" />
                            </a>
                          ) : (
                            <span className="text-faint">—</span>
                          )}
                        </td>
                        <td className="py-2">
                          <form action={reviewPayment} className="flex min-w-[200px] flex-col gap-2">
                            <input type="hidden" name="id" value={p.id} />
                            <input type="hidden" name="locale" value={locale} />
                            <input type="hidden" name="view" value={view} />
                            <input
                              name="note"
                              maxLength={500}
                              placeholder={t("notePlaceholder")}
                              className="rounded-lg bg-panel px-2 py-1 text-[12px] text-heading shadow-neu-inset outline-none"
                            />
                            <div className="flex flex-wrap items-center gap-2">
                              {CAN_APPROVE.includes(p.status) && (
                                <Button type="submit" name="action" value="approve" size="sm">
                                  {t("approve")}
                                </Button>
                              )}
                              {CAN_REJECT.includes(p.status) && (
                                <Button type="submit" name="action" value="reject" size="sm" variant="outline">
                                  {t("reject")}
                                </Button>
                              )}
                              {p.status === "approved" && p.auto_approved && !p.reviewed_at && (
                                <Button type="submit" name="action" value="check" size="sm" variant="secondary">
                                  {t("markChecked")}
                                </Button>
                              )}
                              {p.status === "approved" && (
                                <details className="text-[12px]">
                                  <summary className="cursor-pointer text-destructive">{t("revoke")}</summary>
                                  <p className="my-1 max-w-[200px] text-mutedtext">{t("revokeConfirm")}</p>
                                  <Button type="submit" name="action" value="revoke" size="sm" variant="outline" className="text-destructive">
                                    {t("revokeNow")}
                                  </Button>
                                </details>
                              )}
                            </div>
                          </form>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="neu space-y-3 p-6">
            <h2 className="text-base font-bold text-heading">{t("passesTitle", { count: passes.length })}</h2>
            {passes.length === 0 ? (
              <p className="text-sm text-mutedtext">{t("noPasses")}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wider text-faint">
                      <th className={cn(th, "text-start")}>{t("user")}</th>
                      <th className={cn(th, "text-start")}>{t("activeUntil")}</th>
                      <th className={cn(th, "text-start")}>{t("started")}</th>
                      <th className={cn(th, "text-end")}>{t("passBalance")}</th>
                      <th className={cn(th, "text-end")}>{t("actions")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-borderstrong/40">
                    {passes.map((p) => (
                      <tr key={p.user_id}>
                        <td className="py-2 text-heading">
                          <Link href={`/dashboard/ai-costs/${p.user_id}`} className="font-medium underline-offset-2 hover:underline">
                            <span dir="ltr">{who(p.user_id)}</span>
                          </Link>
                        </td>
                        <td className="py-2 text-[12px] text-body">{dayFmt.format(new Date(p.active_until))}</td>
                        <td className="py-2 text-[12px] text-mutedtext">{dayFmt.format(new Date(p.started_at))}</td>
                        <td className="py-2 text-end font-mono tabular-nums">{num.format(Number(revenue.get(p.user_id)?.pass_balance ?? 0))}</td>
                        <td className="py-2 text-end">
                          <form action={expirePass}>
                            <input type="hidden" name="user" value={p.user_id} />
                            <input type="hidden" name="locale" value={locale} />
                            <input type="hidden" name="view" value={view} />
                            <Button type="submit" size="sm" variant="outline" className="text-destructive">
                              {t("expireNow")}
                            </Button>
                          </form>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
