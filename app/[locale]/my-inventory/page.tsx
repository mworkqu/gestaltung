import { getTranslations, setRequestLocale } from "next-intl/server";

import { MyInventory } from "@/components/inventory/my-inventory";
import { cn } from "@/lib/utils";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "MyInventory" });
  return { title: t("metaTitle"), description: t("metaDescription") };
}

// The CLIENT's own inventory — not the workshop's production stock at
// /inventory, which is a different table for a different role.
export const dynamic = "force-dynamic";

export default async function MyInventoryPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("MyInventory");
  const isRtl = locale === "ar";
  const mono = (extra = "") =>
    cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  return (
    <div className="container max-w-3xl space-y-6 py-8">
      <header className="space-y-2">
        <p className={mono("text-[10px] text-azure")}>{t("kicker")}</p>
        <h1 className="text-3xl font-extrabold tracking-tight text-heading sm:text-4xl">
          {t("heading")}
        </h1>
        <p className="max-w-xl text-base leading-relaxed text-body">{t("intro")}</p>
      </header>

      <MyInventory />
    </div>
  );
}
