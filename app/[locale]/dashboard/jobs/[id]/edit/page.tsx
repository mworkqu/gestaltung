import { notFound, redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowLeft } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { getSessionContext } from "@/lib/auth/get-session";
import { createClient } from "@/lib/supabase/server";
import type { Job } from "@/lib/supabase/types";
import { EditJobForm } from "@/components/jobs/edit-job-form";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function EditJobPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const [session, t, supabase] = await Promise.all([
    getSessionContext(),
    getTranslations("Jobs"),
    createClient(),
  ]);
  if (!session) redirect(`/${locale}/sign-in`);

  // Only clients can edit their own submitted jobs.
  if (session.profile.role !== "client") redirect(`/${locale}/dashboard/jobs/${id}`);

  const { data: job } = await supabase
    .from("jobs")
    .select("*")
    .eq("id", id)
    .single<Job>();
  if (!job) notFound();

  const isRtl = locale === "ar";
  const mono = (extra = "") =>
    cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  if (job.status !== "submitted" || job.job_source === "internal") {
    return (
      <div className="mx-auto max-w-2xl">
        <Link
          href={`/dashboard/jobs/${id}`}
          className="inline-flex items-center gap-2 text-sm text-mutedtext transition-colors hover:text-heading"
        >
          <ArrowLeft className={cn("h-4 w-4", isRtl && "rotate-180")} />
          {t("backToList")}
        </Link>
        <p className="mt-8 text-sm text-mutedtext">{t("editOnlySubmitted")}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        href={`/dashboard/jobs/${id}`}
        className="inline-flex items-center gap-2 text-sm text-mutedtext transition-colors hover:text-heading"
      >
        <ArrowLeft className={cn("h-4 w-4", isRtl && "rotate-180")} />
        {t("backToList")}
      </Link>

      <p className={cn(mono("text-[10px] text-azure"), "mt-4")}>{t("kicker")}</p>
      <h1 className="mt-2 text-2xl font-extrabold text-heading">
        {t("editTitle")}
      </h1>

      <div className="neu mt-8 p-6 sm:p-8">
        <EditJobForm job={job} />
      </div>
    </div>
  );
}
