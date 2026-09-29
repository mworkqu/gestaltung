import { getTranslations, setRequestLocale } from "next-intl/server";
import { MessageCircle } from "lucide-react";

import type { Part } from "@/lib/supabase/types";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { PartCard } from "@/components/parts/part-card";
import { PartsFilters } from "@/components/parts/parts-filters";
import { DemandBeacon } from "@/components/parts/demand-beacon";
import { isListed, listedCategories } from "@/lib/store/categories";
import { cn } from "@/lib/utils";
import { metaFor } from "@/lib/meta";

// Published catalog reflects admin publish toggles immediately.
export const dynamic = "force-dynamic";

const PAGE_SIZE = 48;

const WHATSAPP_DIGITS =
  process.env.NEXT_PUBLIC_WHATSAPP_NUMBER?.replace(/\D/g, "") || null;

export const generateMetadata = metaFor("store");

export default async function PartsStorePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    q?: string;
    category?: string;
    material?: string;
    stock?: string;
    page?: string;
  }>;
}) {
  const { locale } = await params;
  const { q, category, material, stock, page: pageParam } = await searchParams;
  setRequestLocale(locale);

  const t = await getTranslations("Parts");
  const isRtl = locale === "ar";
  const mono = (extra = "") =>
    cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  const supabase = await createClient();

  // Filter options: every listed category and material. Two light columns,
  // paged because a response is capped at 1,000 rows.
  const facetRows: { category: string | null; material: string | null; is_published: boolean; merged_into: string | null }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data: page } = await supabase
      .from("parts")
      .select("category, material, is_published, merged_into")
      .eq("is_published", true)
      .not("lead_time_class", "is", null)
      .order("id")
      .range(from, from + 999);
    facetRows.push(...((page ?? []) as typeof facetRows));
    if ((page ?? []).length < 1000) break;
  }
  const categories = listedCategories(facetRows);
  const materials = Array.from(
    new Set(facetRows.filter(isListed).map((p) => p.material).filter((m): m is string => !!m))
  ).sort();

  // The catalogue itself: filtered, searched and paged in the database. The
  // homepage hero posts here as ?q=; it matches both locales' names, the SKU,
  // the description and the material, so an Arabic visitor searching an
  // English part name (or a SKU off an invoice) still finds it.
  const term = q?.trim() ?? "";
  const pageNo = Math.max(1, Math.trunc(Number(pageParam)) || 1);
  let query = supabase
    .from("parts")
    .select("*", { count: "exact" })
    .eq("is_published", true)
    .is("merged_into", null)
    // Nothing without a delivery date is listed (owner, 2026-09-29): a Voltaat
    // item out of stock is hidden until it's back, or replaced by a DigiKey /
    // Mouser backup (0041). Its page still opens from an old link.
    .not("lead_time_class", "is", null);
  if (category) query = query.eq("category", category);
  if (material) query = query.eq("material", material);
  if (stock && stock !== "on_request") query = query.eq("lead_time_class", stock);
  if (term) {
    // PostgREST .or() syntax: commas, parentheses and wildcards in the term would break it.
    const safe = term.replace(/[,()%*\\]/g, " ").trim();
    if (safe) {
      const like = `%${safe}%`;
      query = query.or(
        ["name", "name_ar", "sku", "description", "description_ar", "material"].map((c) => `${c}.ilike.${like}`).join(",")
      );
    }
  }
  const { data, count } = await query
    .order("name", { ascending: true })
    .order("id", { ascending: true })
    .range((pageNo - 1) * PAGE_SIZE, pageNo * PAGE_SIZE - 1);
  const parts = ((data ?? []) as Part[]).filter(isListed);
  const total = count ?? parts.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageHref = (n: number) => ({
    pathname: "/store" as const,
    query: { ...(q ? { q } : {}), ...(category ? { category } : {}), ...(material ? { material } : {}), ...(stock ? { stock } : {}), ...(n > 1 ? { page: String(n) } : {}) },
  });

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
        current={{ q, category, material, stock }}
      />

      {parts.length === 0 ? (
        <div className="neu flex flex-col items-center gap-4 p-12 text-center">
          {term && pageNo === 1 && <DemandBeacon kind="zero_search" searchTerm={term} />}
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
        <>
          <p className="text-sm text-mutedtext">{t("resultCount", { count: total })}</p>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {parts.map((part) => (
              <PartCard key={part.id} part={part} locale={locale} />
            ))}
          </div>
          {pages > 1 && (
            <nav className="flex items-center justify-center gap-3 text-sm" aria-label={t("pagination")}>
              {pageNo > 1 ? (
                <Link href={pageHref(pageNo - 1)} className="rounded-full border border-borderstrong px-4 py-1.5 text-heading hover:border-cobalt">
                  {t("prevPage")}
                </Link>
              ) : null}
              <span className="tabular-nums text-mutedtext">{t("pageOf", { page: pageNo, pages })}</span>
              {pageNo < pages ? (
                <Link href={pageHref(pageNo + 1)} className="rounded-full border border-borderstrong px-4 py-1.5 text-heading hover:border-cobalt">
                  {t("nextPage")}
                </Link>
              ) : null}
            </nav>
          )}
        </>
      )}
    </div>
  );
}
