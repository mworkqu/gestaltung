import { getTranslations, setRequestLocale } from "next-intl/server";
import { MessageCircle } from "lucide-react";

import type { Part } from "@/lib/supabase/types";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { PartCard } from "@/components/parts/part-card";
import { PartsFilters } from "@/components/parts/parts-filters";
import { cn } from "@/lib/utils";

// Published catalog reflects admin publish toggles immediately.
export const dynamic = "force-dynamic";

const WHATSAPP_DIGITS =
  process.env.NEXT_PUBLIC_WHATSAPP_NUMBER?.replace(/\D/g, "") || null;

export default async function PartsStorePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ category?: string; material?: string; stock?: string }>;
}) {
  const { locale } = await params;
  const { category, material, stock } = await searchParams;
  setRequestLocale(locale);

  const t = await getTranslations("Parts");
  const isRtl = locale === "ar";
  const mono = (extra = "") =>
    cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  const supabase = await createClient();

  // Public RLS policy returns only published rows for anon visitors. Fetch the
  // full published set once so we can both derive filter options and apply the
  // (small-catalog) filters in memory.
  const { data } = await supabase
    .from("parts")
    .select("*")
    .eq("is_published", true)
    .order("name", { ascending: true });

  const all = (data ?? []) as Part[];

  const categories = Array.from(new Set(all.map((p) => p.category))).sort();
  const materials = Array.from(
    new Set(all.map((p) => p.material).filter((m): m is string => !!m))
  ).sort();

  const parts = all.filter(
    (p) =>
      (!category || p.category === category) &&
      (!material || p.material === material) &&
      (!stock || p.stock_status === stock)
  );

  const waHref = WHATSAPP_DIGITS
    ? `https://wa.me/${WHATSAPP_DIGITS}?text=${encodeURIComponent(t("emptyWhatsapp"))}`
    : null;

  return (
    <div className="container space-y-8 py-8">
      <header className="space-y-3">
        <p className={mono("text-[10px] text-azure")}>{t("kicker")}</p>
        <h1 className="text-3xl font-extrabold tracking-tight text-heading sm:text-4xl">
          {t("heading")}
        </h1>
        <p className="max-w-2xl text-base leading-relaxed text-body">
          {t("subtext")}
        </p>
      </header>

      <PartsFilters
        categories={categories}
        materials={materials}
        current={{ category, material, stock }}
      />

      {parts.length === 0 ? (
        <div className="neu flex flex-col items-center gap-4 p-12 text-center">
          <p className="text-base font-semibold text-heading">{t("emptyTitle")}</p>
          <p className="max-w-md text-sm text-mutedtext">{t("emptyBody")}</p>
          {waHref ? (
            <Button asChild className="rounded-full">
              <a href={waHref} target="_blank" rel="noopener noreferrer">
                <MessageCircle className="h-4 w-4" />
                {t("emptyCta")}
              </a>
            </Button>
          ) : (
            <Button asChild className="rounded-full">
              <Link href="/contact">{t("emptyCtaFallback")}</Link>
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {parts.map((part) => (
            <PartCard key={part.id} part={part} locale={locale} />
          ))}
        </div>
      )}
    </div>
  );
}
