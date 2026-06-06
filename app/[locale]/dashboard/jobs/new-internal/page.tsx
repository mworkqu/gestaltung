import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { getSessionContext } from "@/lib/auth/get-session";
import { InternalJobForm } from "@/components/jobs/internal-job-form";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function NewInternalJobPage({
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
    session.profile.role === "workshop" && !!session.profile.tenant_id;

  return (
    <div className="mx-auto max-w-2xl">
      <p className={mono("text-[10px] text-azure")}>{t("kicker")}</p>
      <h1 className="mt-2 text-2xl font-extrabold text-heading">
        {t("internalTitle")}
      </h1>

      {canCreate ? (
        <div className="neu mt-8 p-6 sm:p-8">
          <InternalJobForm />
        </div>
      ) : (
        <div className="neu mt-8 p-8 text-center">
          <p className="text-base font-semibold text-heading">
            {t("notWorkshopTitle")}
          </p>
          <p className="mt-1 text-sm text-mutedtext">{t("notWorkshopBody")}</p>
        </div>
      )}
    </div>
  );
}
