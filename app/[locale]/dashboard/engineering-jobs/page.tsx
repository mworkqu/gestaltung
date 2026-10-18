import { engineerServicePrices } from "@/lib/services/server";
import { ServicePricesForm } from "./service-prices";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { ENGINEERING_BUCKET } from "@/lib/engineering/config";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { setJobStatus } from "./actions";
import { UploadResult } from "./upload-result";

// Engineering jobs queue (owner, 2026-10-18): STEP files and other work our
// engineers deliver within hours. Table + RPC are migration 0091.

export const dynamic = "force-dynamic";

type JobRow = {
  id: string;
  project_id: string | null;
  user_id: string;
  kind: string;
  status: string;
  tokens: number;
  eta_at: string | null;
  note: string | null;
  admin_note: string | null;
  result_path: string | null;
  result_name: string | null;
  returned_path: string | null;
  returned_at: string | null;
  ready_at: string | null;
  is_test: boolean;
  created_at: string;
};

const VIEWS = ["open", "ready", "all"] as const;
type View = (typeof VIEWS)[number];
const KINDS = ["step_model", "pcb_gerber", "assembly", "cad_engineer"];
const STATUSES = ["queued", "in_progress", "ready", "failed", "cancelled"];
const MISSING = ["PGRST205", "42P01", "PGRST202", "42883"];

export default async function EngineeringJobsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ view?: string; err?: string; done?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("AdminJobs");
  const view: View = (VIEWS as readonly string[]).includes(sp.view ?? "") ? (sp.view as View) : "open";
  const isRtl = locale === "ar";
  const mono = (extra = "") => cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);
  const loc = isRtl ? "ar-QA-u-nu-latn" : "en-GB";
  const num = new Intl.NumberFormat(loc);
  const timeFmt = new Intl.DateTimeFormat(loc, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Qatar" });

  const supabase = await createClient();
  const now = Date.now();
  const weekAgo = new Date(now - 7 * 86400000).toISOString();
  const monthStart = new Date(now);
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  let q = supabase
    .from("engineering_jobs")
    .select(
      "id, project_id, user_id, kind, status, tokens, eta_at, note, admin_note, result_path, result_name, returned_path, returned_at, ready_at, is_test, created_at",
    )
    .limit(300);
  if (view === "open") q = q.in("status", ["queued", "in_progress"]).order("created_at", { ascending: true });
  else {
    if (view === "ready") q = q.eq("status", "ready");
    q = q.order("created_at", { ascending: false });
  }

  const [listRes, openRes, readyWeekRes, monthRes] = await Promise.all([
    q,
    supabase.from("engineering_jobs").select("eta_at").in("status", ["queued", "in_progress"]),
    supabase.from("engineering_jobs").select("id", { count: "exact", head: true }).eq("status", "ready").gte("ready_at", weekAgo),
    supabase
      .from("engineering_jobs")
      .select("tokens")
      .gte("created_at", monthStart.toISOString())
      .in("status", ["queued", "in_progress", "ready"]),
  ]);

  const errors = [listRes.error, openRes.error, readyWeekRes.error, monthRes.error];
  const migrationMissing = errors.some((e) => !!e && MISSING.includes(e.code ?? ""));
  const failed = errors.find((e) => !!e);

  const jobs = (listRes.data ?? []) as JobRow[];
  const openRows = (openRes.data ?? []) as { eta_at: string | null }[];
  const overdue = openRows.filter((r) => r.eta_at && new Date(r.eta_at).getTime() < now).length;
  const monthTokens = (monthRes.data ?? []).reduce((s, r) => s + Number(r.tokens ?? 0), 0);

  // Emails and project names for every job on screen.
  const userIds = [...new Set(jobs.map((j) => j.user_id))];
  const projectIds = [...new Set(jobs.map((j) => j.project_id).filter((x): x is string => !!x))];
  const emailOf = new Map<string, string | null>();
  const projectOf = new Map<string, string | null>();
  await Promise.all([
    userIds.length > 0
      ? supabase
          .from("profiles")
          .select("id, email")
          .in("id", userIds)
          .then(({ data }) => {
            for (const r of data ?? []) emailOf.set(r.id as string, (r.email as string | null) ?? null);
          })
      : null,
    projectIds.length > 0
      ? supabase
          .from("projects")
          .select("id, name")
          .in("id", projectIds)
          .then(({ data }) => {
            for (const r of data ?? []) projectOf.set(r.id as string, (r.name as string | null) ?? null);
          })
      : null,
  ]);
  const who = (id: string) => emailOf.get(id) ?? `${t("guest")} ${id.slice(0, 8)}`;

  // Returned and result files: signed URLs for one hour (admin storage policy reads the bucket).
  const signed = new Map<string, string>();
  await Promise.all(
    jobs.flatMap((j) =>
      [j.returned_path, j.result_path]
        .filter((p): p is string => !!p)
        .map(async (p) => {
          const { data } = await supabase.storage.from(ENGINEERING_BUCKET).createSignedUrl(p, 3600);
          if (data?.signedUrl) signed.set(p, data.signedUrl);
        }),
    ),
  );

  const stats: { label: string; value: string; warn?: boolean }[] = [
    { label: t("statOpen"), value: num.format(openRows.length) },
    { label: t("statOverdue"), value: num.format(overdue), warn: overdue > 0 },
    { label: t("statReadyWeek"), value: num.format(readyWeekRes.count ?? 0) },
    { label: t("statTokensMonth"), value: num.format(monthTokens) },
  ];

  const dueText = (j: JobRow) => {
    if (!j.eta_at || (j.status !== "queued" && j.status !== "in_progress")) return null;
    const mins = Math.round((new Date(j.eta_at).getTime() - now) / 60000);
    const abs = Math.abs(mins);
    const text = `${num.format(Math.floor(abs / 60))} ${t("hShort")} ${num.format(abs % 60)} ${t("mShort")}`;
    return mins < 0 ? { late: true, label: t("overdueBy", { time: text }) } : { late: false, label: t("dueIn", { time: text }) };
  };
  const kindLabel = (k: string) => (KINDS.includes(k) ? t(`kind_${k}`) : k);
  const statusLabel = (s: string) => (STATUSES.includes(s) ? t(`status_${s}`) : s);
  const th = "pb-2 font-medium";
  const uploadLabels = {
    file: t("resultFileInput"),
    notePlaceholder: t("notePlaceholder"),
    submit: t("uploadReady"),
    uploading: t("uploading"),
    tooBig: t("tooBig"),
    failed: t("uploadFailed"),
  };

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
                  <dd className={cn("font-mono text-lg font-bold tabular-nums", s.warn ? "text-destructive" : "text-heading")}>{s.value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="neu space-y-4 p-6">
            <nav className="flex flex-wrap gap-2" aria-label={t("title")}>
              {VIEWS.map((v) => (
                <Link
                  key={v}
                  href={`/dashboard/engineering-jobs?view=${v}`}
                  className={cn(
                    "rounded-xl px-4 py-2 text-sm font-semibold",
                    v === view ? "bg-panel text-heading shadow-neu-inset" : "text-mutedtext shadow-neu-sm",
                  )}
                >
                  {t(`view_${v}`)}
                </Link>
              ))}
            </nav>

            {jobs.length === 0 ? (
              <p className="text-sm text-mutedtext">{t("none")}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1100px] text-sm">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wider text-faint">
                      <th className={cn(th, "text-start")}>{t("created")}</th>
                      <th className={cn(th, "text-start")}>{t("user")}</th>
                      <th className={cn(th, "text-start")}>{t("project")}</th>
                      <th className={cn(th, "text-start")}>{t("kind")}</th>
                      <th className={cn(th, "text-start")}>{t("status")}</th>
                      <th className={cn(th, "text-end")}>{t("tokens")}</th>
                      <th className={cn(th, "ps-4 text-start")}>{t("eta")}</th>
                      <th className={cn(th, "text-start")}>{t("notes")}</th>
                      <th className={cn(th, "text-start")}>{t("files")}</th>
                      <th className={cn(th, "text-start")}>{t("actions")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-borderstrong/40">
                    {jobs.map((j) => {
                      const due = dueText(j);
                      const isOpen = j.status === "queued" || j.status === "in_progress";
                      return (
                        <tr key={j.id} className="align-top">
                          <td className="whitespace-nowrap py-2 text-[12px] text-mutedtext">{timeFmt.format(new Date(j.created_at))}</td>
                          <td className="py-2 text-heading">
                            <Link href={`/dashboard/ai-costs/${j.user_id}`} className="font-medium underline-offset-2 hover:underline">
                              <span dir="ltr">{who(j.user_id)}</span>
                            </Link>
                          </td>
                          <td className="py-2 text-[12px]">
                            {j.project_id ? (
                              <Link href={`/projects/${j.project_id}/engineering`} className="text-azure underline-offset-2 hover:underline">
                                {projectOf.get(j.project_id) ?? t("project")}
                              </Link>
                            ) : (
                              <span className="text-faint">—</span>
                            )}
                          </td>
                          <td className="py-2 text-[12px] text-body">
                            {kindLabel(j.kind)}
                            {j.is_test ? ` (${t("test")})` : ""}
                          </td>
                          <td className="py-2 text-[12px] font-medium text-heading">{statusLabel(j.status)}</td>
                          <td className="py-2 text-end font-mono tabular-nums text-heading">{num.format(j.tokens)}</td>
                          <td className="whitespace-nowrap py-2 ps-4 text-[12px] text-mutedtext">
                            {j.eta_at ? timeFmt.format(new Date(j.eta_at)) : "—"}
                            {due && <span className={cn("block font-medium", due.late ? "text-destructive" : "text-body")}>{due.label}</span>}
                          </td>
                          <td className="max-w-[240px] py-2 text-[12px]">
                            {j.note && (
                              <p className="text-body">
                                <span className="text-faint">{t("userNote")}: </span>
                                {j.note}
                              </p>
                            )}
                            {j.admin_note && (
                              <p className="text-mutedtext">
                                <span className="text-faint">{t("adminNote")}: </span>
                                {j.admin_note}
                              </p>
                            )}
                            {!j.note && !j.admin_note && <span className="text-faint">—</span>}
                          </td>
                          <td className="py-2 text-[12px]">
                            <a href={`/${locale}/dashboard/engineering-jobs/${j.id}/snapshot`} className="block text-azure underline" download>
                              {t("downloadSnapshot")}
                            </a>
                            {j.result_path && signed.has(j.result_path) && (
                              <a href={signed.get(j.result_path)} target="_blank" rel="noopener noreferrer" className="block text-azure underline">
                                {t("resultFile")}: <span dir="ltr">{j.result_name ?? j.result_path.split("/").pop()}</span>
                              </a>
                            )}
                            {j.returned_path && signed.has(j.returned_path) && (
                              <a href={signed.get(j.returned_path)} target="_blank" rel="noopener noreferrer" className="block text-azure underline">
                                {t("returnedFile")}
                                {j.returned_at ? ` · ${timeFmt.format(new Date(j.returned_at))}` : ""}
                              </a>
                            )}
                          </td>
                          <td className="py-2">
                            {isOpen ? (
                              <div className="flex min-w-[240px] flex-col gap-3">
                                {j.status === "queued" && (
                                  <form action={setJobStatus}>
                                    <input type="hidden" name="id" value={j.id} />
                                    <input type="hidden" name="locale" value={locale} />
                                    <input type="hidden" name="view" value={view} />
                                    <Button type="submit" name="status" value="in_progress" size="sm" variant="secondary">
                                      {t("start")}
                                    </Button>
                                  </form>
                                )}
                                <UploadResult jobId={j.id} locale={locale} labels={uploadLabels} />
                                <details className="text-[12px]">
                                  <summary className="cursor-pointer text-destructive">{t("markFailed")}</summary>
                                  <form action={setJobStatus} className="mt-1 flex flex-col gap-2">
                                    <p className="max-w-[220px] text-mutedtext">{t("failConfirm")}</p>
                                    <input type="hidden" name="id" value={j.id} />
                                    <input type="hidden" name="locale" value={locale} />
                                    <input type="hidden" name="view" value={view} />
                                    <input
                                      name="note"
                                      maxLength={500}
                                      placeholder={t("notePlaceholder")}
                                      className="rounded-lg bg-panel px-2 py-1 text-[12px] text-heading shadow-neu-inset outline-none"
                                    />
                                    <Button type="submit" name="status" value="failed" size="sm" variant="outline" className="text-destructive">
                                      {t("failNow")}
                                    </Button>
                                  </form>
                                </details>
                              </div>
                            ) : j.status === "ready" ? (
                              <details className="text-[12px]">
                                <summary className="cursor-pointer text-azure">{t("replaceFile")}</summary>
                                <div className="mt-2">
                                  <UploadResult jobId={j.id} locale={locale} labels={uploadLabels} />
                                </div>
                              </details>
                            ) : (
                              <span className="text-faint">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      <ServicePricesForm locale={locale} prices={await engineerServicePrices(supabase)} />
    </div>
  );
}
