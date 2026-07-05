import { setRequestLocale, getTranslations } from "next-intl/server";

import { PartForm } from "@/components/parts/part-form";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function NewPartPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("PartsDashboard");
  const isRtl = locale === "ar";
  const mono = (extra = "") =>
    cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  return (
    <div className="mx-auto max-w-2xl">
      <p className={mono("text-[10px] text-azure")}>{t("kicker")}</p>
      <h1 className="mt-2 text-2xl font-extrabold text-heading">{t("newTitle")}</h1>
      <div className="neu mt-8 p-6 sm:p-8">
        <PartForm mode="create" />
      </div>
    </div>
  );
}
