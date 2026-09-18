import { getTranslations, setRequestLocale } from "next-intl/server";

import { NewProjectForm } from "@/components/projects/new-project-form";
import { cn } from "@/lib/utils";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Projects" });
  return { title: t("newHeading"), description: t("metaDescription") };
}

// No sign-in wall. The anonymous session is created by the form, on submit.
export default async function NewProjectPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("Projects");
  const isRtl = locale === "ar";
  const mono = (extra = "") =>
    cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  return (
    <div className="container max-w-xl space-y-6 py-12">
      <header className="space-y-2">
        <p className={mono("text-[10px] text-azure")}>{t("kicker")}</p>
        <h1 className="text-3xl font-extrabold tracking-tight text-heading">
          {t("newHeading")}
        </h1>
        <p className="text-base leading-relaxed text-body">{t("newIntro")}</p>
      </header>

      <NewProjectForm />
    </div>
  );
}
