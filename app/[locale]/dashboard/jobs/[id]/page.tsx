import { notFound, redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowLeft, Download, FileBox } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { getSessionContext } from "@/lib/auth/get-session";
import { createClient } from "@/lib/supabase/server";
import { CAD_BUCKET } from "@/lib/jobs/constants";
import type { Job, JobFile } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const session = await getSessionContext();
  if (!session) redirect(`/${locale}/sign-in`);

  const t = await getTranslations("Jobs");
  const isRtl = locale === "ar";
  const mono = (extra = "") =>
    cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  const supabase = await createClient();

  // RLS ensures only an owner-tenant client or super_admin can load this row.
  const { data: job } = await supabase
    .from("jobs")
    .select("*")
    .eq("id", id)
    .single<Job>();
  if (!job) notFound();

  const { data: fileRows } = await supabase
    .from("job_files")
    .select("*")
    .eq("job_id", id)
    .order("uploaded_at", { ascending: true });
  const files = (fileRows ?? []) as JobFile[];

  // Short-lived signed URLs (60s) — bucket is private, generated per request.
  const filesWithUrls = await Promise.all(
    files.map(async (f) => {
      const { data } = await supabase.storage
        .from(CAD_BUCKET)
        .createSignedUrl(f.storage_path, 60);
      return { ...f, url: data?.signedUrl ?? null };
    })
  );

  // super_admin: show which client this job belongs to.
  let clientName: string | null = null;
  if (session.profile.role === "super_admin") {
    const { data: ten } = await supabase
      .from("tenants")
      .select("name")
      .eq("id", job.client_tenant_id)
      .single<{ name: string }>();
    clientName = ten?.name ?? null;
  }

  const dateFmt = new Intl.DateTimeFormat(locale === "ar" ? "ar-QA" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  const rows: { label: string; value: string }[] = [
    { label: t("methodLabel"), value: t(`method_${job.method}`) },
    { label: t("statusLabel"), value: t(`status_${job.status}`) },
    { label: t("quantityLabel"), value: String(job.quantity) },
    { label: t("materialLabel"), value: job.material || "—" },
    ...(clientName ? [{ label: t("colClient"), value: clientName }] : []),
    { label: t("createdLabel"), value: dateFmt.format(new Date(job.created_at)) },
  ];

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        href="/dashboard/jobs"
        className="inline-flex items-center gap-2 text-sm text-mutedtext transition-colors hover:text-heading"
      >
        <ArrowLeft className={cn("h-4 w-4", isRtl && "rotate-180")} />
        {t("backToList")}
      </Link>

      <div className="mt-4 flex items-center gap-3">
        <h1 className="text-2xl font-extrabold text-heading">{job.title}</h1>
        <span className="rounded-full bg-cobalt/10 px-2.5 py-0.5 text-[11px] font-semibold text-cobalt">
          {t(`status_${job.status}`)}
        </span>
      </div>

      <div className="neu mt-6 divide-y divide-borderstrong/60 p-2">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-center justify-between gap-4 px-4 py-3"
          >
            <span className={mono("text-[10px] text-mutedtext")}>
              {row.label}
            </span>
            <span className="text-sm font-medium text-heading">{row.value}</span>
          </div>
        ))}
      </div>

      {job.notes && (
        <div className="neu mt-6 p-5">
          <p className={mono("text-[10px] text-mutedtext")}>{t("notesLabel")}</p>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-body">
            {job.notes}
          </p>
        </div>
      )}

      {/* Files */}
      <div className="mt-6">
        <p className={mono("text-[10px] text-azure")}>{t("filesTitle")}</p>
        {filesWithUrls.length === 0 ? (
          <p className="mt-2 text-sm text-mutedtext">{t("noFiles")}</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {filesWithUrls.map((f) => (
              <li
                key={f.id}
                className="neu flex items-center gap-3 px-4 py-3"
              >
                <FileBox className="h-5 w-5 shrink-0 text-cobalt" strokeWidth={1.5} />
                <span className="flex-1 truncate text-sm text-heading" dir="ltr">
                  {f.file_name}
                </span>
                <span className="shrink-0 text-[11px] uppercase text-faint">
                  {f.file_ext}
                </span>
                {f.url ? (
                  <a
                    href={f.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-cobalt px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-cobalt-hover"
                  >
                    <Download className="h-3.5 w-3.5" />
                    {t("download")}
                  </a>
                ) : (
                  <span className="shrink-0 text-[11px] text-destructive">
                    {t("error_unknown")}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
