import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { getSessionContext } from "@/lib/auth/get-session";
import { NewJobForm } from "@/components/jobs/new-job-form";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function NewJobPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await getSessionContext();
  if (!session) redirect(`/${locale}/sign-in`);

  const t = await getTranslations("Jobs");
  const isRtl = locale === "ar";
  const mono = (extra = "") =>
    cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  const canCreate =
    session.profile.role === "client" && !!session.profile.tenant_id;

  return (
    <div className="mx-auto max-w-2xl">
      <p className={mono("text-[10px] text-azure")}>{t("kicker")}</p>
      <h1 className="mt-2 text-2xl font-extrabold text-heading">
        {t("newTitle")}
      </h1>

      {canCreate ? (
        <div className="neu mt-8 p-6 sm:p-8">
          <NewJobForm tenantId={session.profile.tenant_id as string} />
        </div>
      ) : (
        <div className="neu mt-8 p-8 text-center">
          <p className="text-base font-semibold text-heading">
            {t("notClientTitle")}
          </p>
          <p className="mt-1 text-sm text-mutedtext">{t("notClientBody")}</p>
        </div>
      )}
    </div>
  );
}
