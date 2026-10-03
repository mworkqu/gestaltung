import { getTranslations, setRequestLocale } from "next-intl/server";
import { pageMetadata } from "@/lib/seo";
import { ArrowRight, Lightbulb, Plus, Search, ShoppingBag, UploadCloud } from "lucide-react";
import { categoryLabel } from "@/lib/store/category-label";
import { fetchAllRows } from "@/lib/supabase/fetch-all";

import type { Part } from "@/lib/supabase/types";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { DesignDropzone } from "@/components/design/design-dropzone";
import { PartCard } from "@/components/parts/part-card";
import { HomeCallback } from "@/components/store-landing/callback-form";
import { isListed, listedCategories } from "@/lib/store/categories";
import { cn } from "@/lib/utils";

// Featured products reflect admin publish toggles immediately.
export const dynamic = "force-dynamic";

// Store-first metadata (overrides the sitewide default, which mentions the
// inventory platform — never surfaced on the store landing).
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "StoreLanding" });
  return pageMetadata({ locale, path: "", title: t("metaTitle"), description: t("metaDescription") });
}

export default async function Home({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("StoreLanding");
  const isRtl = locale === "ar";
  const mono = (extra = "") =>
    cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  // Featured: in-stock products with a photo, one per category so the row
  // shows the range (owner, 2026-09-29: newest-first showed only photo-less parts).
  // Degrade to the empty state if Supabase env is absent (fresh local checkout).
  let products: Part[] = [];
  let categories: string[] = [];
  if (
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("parts")
      .select("*")
      .eq("is_published", true)
      .eq("lead_time_class", "in_stock")
      .not("image_url", "is", null)
      .order("updated_at", { ascending: false })
      .limit(200);
    const pool = ((data ?? []) as Part[]).filter(isListed);
    const byCategory = new Map<string, Part>();
    for (const p of pool) if (!byCategory.has(p.category ?? "")) byCategory.set(p.category ?? "", p);
    products = [...byCategory.values(), ...pool.filter((p) => !byCategory.has(p.category ?? "") || byCategory.get(p.category ?? "") !== p)].slice(0, 8);

    // Every category with a listed product (published, not a merged duplicate),
    // not just those in the featured eight, so the quick-links cover the whole
    // catalog and never lead to an empty page (audit #15). Paged: a response
    // stops at 1,000 rows.
    const { rows: catRows } = await fetchAllRows<{ category: string | null; is_published: boolean; merged_into: string | null }>(
      (from, to) =>
        supabase.from("parts").select("category, is_published, merged_into").eq("is_published", true).not("lead_time_class", "is", null).order("id").range(from, to)
    );
    categories = listedCategories(catRows);
  }


  return (
    <div className="container space-y-6 py-6">
      {/* Hero (audit #12): one line of who we are, then three clear choices. */}
      <section className="space-y-6">
        <div className="animate-fade-up space-y-3 px-1 pt-2">
          <span className="inline-flex w-fit items-center gap-2 rounded-full bg-panel px-3 py-1.5 shadow-neu-sm">
            <span className="h-2 w-2 rounded-full bg-cobalt" />
            <span className={mono("text-[10px] text-mutedtext")}>{t("tagline")}</span>
          </span>
          <h1 className="max-w-3xl text-[2.1rem] font-extrabold leading-[1.08] tracking-tight text-heading sm:text-5xl">
            {t("heroChoose")}
          </h1>
          <p className="max-w-2xl text-base leading-relaxed text-body">{t("heroChooseIntro")}</p>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* 1 — Shop parts */}
          <div className="neu animate-fade-up flex min-w-0 flex-col gap-5 p-6 sm:p-8">
            <ChoiceHead icon={<ShoppingBag className="h-5 w-5" />} step="1" title={t("choiceBuyTitle")} text={t("choiceBuyText")} />
            <form action={`/${locale}/store`} className="flex items-stretch gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-2 rounded-2xl border border-white/60 bg-panel px-3.5 shadow-neu-inset">
                <Search className="h-4 w-4 shrink-0 text-faint" strokeWidth={1.75} />
                <input
                  name="q"
                  aria-label={t("searchPh")}
                  placeholder={t("searchPh")}
                  className="w-full min-w-0 flex-1 bg-transparent py-3 text-sm text-heading outline-none placeholder:text-faint"
                />
              </div>
              <Button type="submit" className="rounded-2xl px-5">
                {t("searchBtn")}
              </Button>
            </form>
            <Link href="/store" className="mt-auto inline-flex items-center gap-1 text-sm font-semibold text-cobalt hover:text-cobalt-hover max-md:min-h-11">
              {t("choiceBuyCta")}
              <ArrowRight className={cn("h-4 w-4", isRtl && "-scale-x-100")} />
            </Link>
          </div>

          {/* 2 — Get a part made (I have a file) */}
          <div className="neu animate-fade-up delay-1 flex min-w-0 flex-col gap-5 p-6 sm:p-8">
            <ChoiceHead icon={<UploadCloud className="h-5 w-5" />} step="2" title={t("choiceMakeTitle")} text={t("choiceMakeText")} />
            <DesignDropzone compact />
            {/* No file: we draw it from a sketch (one extra link, not a fourth path). */}
            <Link
              href="/design/drawing"
              className="inline-flex items-center gap-1 text-sm font-semibold text-cobalt hover:text-cobalt-hover max-md:min-h-11"
            >
              {t("drawLink")}
              <ArrowRight className={cn("h-4 w-4", isRtl && "-scale-x-100")} />
            </Link>
          </div>

          {/* 3 — Plan a product (prototyping) */}
          <div className="neu animate-fade-up delay-2 flex min-w-0 flex-col gap-5 p-6 sm:p-8">
            <ChoiceHead icon={<Lightbulb className="h-5 w-5" />} step="3" title={t("choiceIdeaTitle")} text={t("choiceIdeaText")} />
            <ol className="space-y-1.5 text-sm text-body">
              {(["choiceIdeaStep1", "choiceIdeaStep2", "choiceIdeaStep3"] as const).map((k, i) => (
                <li key={k} className="flex items-start gap-2">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-panel text-[11px] font-bold text-cobalt shadow-neu-sm">
                    {i + 1}
                  </span>
                  {t(k)}
                </li>
              ))}
            </ol>
            <div className="mt-auto space-y-2">
              <Button asChild size="lg" className="w-full rounded-2xl">
                <Link href="/projects/new">
                  <Plus className="me-2 h-4 w-4" />
                  {t("choiceIdeaCta")}
                </Link>
              </Button>
              <p className="text-center text-[11px] text-mutedtext">{t("choiceIdeaNote")}</p>
            </div>
          </div>
        </div>
      </section>

      {/* Featured products */}
      <section className="animate-fade-up delay-2 space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4 px-1">
          <div>
            <h2 className="text-2xl font-extrabold tracking-tight text-heading sm:text-3xl">
              {t("featured")}
            </h2>
            <p className="mt-1 text-sm text-mutedtext">{t("featuredSubOrderable")}</p>
          </div>
          <Link
            href="/store"
            className="inline-flex items-center gap-1 text-sm font-semibold text-cobalt hover:text-cobalt-hover max-md:min-h-11"
          >
            {t("viewAll")}
          </Link>
        </div>

        {categories.length > 0 && (
          <div className="flex flex-wrap gap-2 px-1">
            {categories.map((category) => (
              <Link
                key={category}
                href={{ pathname: "/store", query: { category } }}
                className="rounded-full bg-panel px-3.5 py-1.5 text-xs font-medium text-mutedtext shadow-neu-sm transition-colors hover:text-cobalt max-md:inline-flex max-md:min-h-11 max-md:items-center max-md:px-4"
              >
                {categoryLabel(category, locale)}
              </Link>
            ))}
          </div>
        )}

        {products.length === 0 ? (
          <div className="neu p-10 text-center">
            <p className="text-sm text-mutedtext">{t("emptyFeatured")}</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
            {products.map((part) => (
              <PartCard key={part.id} part={part} locale={locale} />
            ))}
          </div>
        )}
      </section>


      {/* Callback CTA */}
      <HomeCallback />
    </div>
  );
}

function ChoiceHead({ icon, step, title, text }: { icon: React.ReactNode; step: string; title: string; text: string }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-panel text-cobalt shadow-neu-sm" aria-hidden>
          {icon}
        </span>
        <span className="text-xs font-semibold text-faint" aria-hidden>
          {step}
        </span>
      </div>
      <h2 className="text-xl font-bold text-heading">{title}</h2>
      <p className="text-sm leading-relaxed text-body">{text}</p>
    </div>
  );
}
