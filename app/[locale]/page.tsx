import { getTranslations, setRequestLocale } from "next-intl/server";
import { Search } from "lucide-react";

import type { Part } from "@/lib/supabase/types";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { DesignDropzone } from "@/components/design/design-dropzone";
import { PartCard } from "@/components/parts/part-card";
import { HomeCallback } from "@/components/store-landing/callback-form";
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
  return { title: t("metaTitle"), description: t("metaDescription") };
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

  // Published parts via the anon-safe RLS read; newest first as "featured".
  // Degrade to the empty state if Supabase env is absent (fresh local checkout).
  let products: Part[] = [];
  if (
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("parts")
      .select("*")
      .eq("is_published", true)
      .order("created_at", { ascending: false })
      .limit(8);
    products = (data ?? []) as Part[];
  }

  const categories = [
    t("cat1"),
    t("cat2"),
    t("cat3"),
    t("cat4"),
    t("cat5"),
    t("cat6"),
  ];

  return (
    <div className="container space-y-6 py-6">
      {/* Hero bento */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Store intro + search */}
        <div className="neu animate-fade-up flex flex-col justify-center gap-6 p-8 sm:p-10 lg:col-span-7 lg:p-12">
          <span className="inline-flex w-fit items-center gap-2 rounded-full bg-panel px-3 py-1.5 shadow-neu-sm">
            <span className="h-2 w-2 rounded-full bg-cobalt" />
            <span className={mono("text-[10px] text-mutedtext")}>{t("tagline")}</span>
          </span>

          <h1 className="text-[2.25rem] font-extrabold leading-[1.05] tracking-tight text-heading sm:text-5xl lg:text-[3rem]">
            {t("heroTitle")}
          </h1>

          {/* Search → store catalog */}
          <form action={`/${locale}/store`} className="flex max-w-xl items-stretch gap-2.5">
            <div className="flex flex-1 items-center gap-2.5 rounded-2xl border border-white/60 bg-panel px-4 shadow-neu-inset">
              <Search className="h-4 w-4 shrink-0 text-faint" strokeWidth={1.75} />
              <input
                name="q"
                placeholder={t("searchPh")}
                className="w-full flex-1 bg-transparent py-3.5 text-sm text-heading outline-none placeholder:text-faint"
              />
            </div>
            <Button type="submit" size="lg" className="rounded-2xl px-6">
              {t("searchBtn")}
            </Button>
          </form>

          {/* Category quick-links */}
          <div className="flex flex-wrap gap-2">
            {categories.map((label) => (
              <Link
                key={label}
                href="/store"
                className="rounded-full bg-panel px-3.5 py-1.5 text-xs font-medium text-mutedtext shadow-neu-sm transition-colors hover:text-cobalt"
              >
                {label}
              </Link>
            ))}
          </div>
        </div>

        {/* Custom manufacturing panel — drag-and-drop CAD upload → quote */}
        <div className="neu animate-fade-up delay-1 p-8 lg:col-span-5">
          <DesignDropzone />
        </div>
      </section>

      {/* Featured products */}
      <section className="animate-fade-up delay-2 space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4 px-1">
          <div>
            <h2 className="text-2xl font-extrabold tracking-tight text-heading sm:text-3xl">
              {t("featured")}
            </h2>
            <p className="mt-1 text-sm text-mutedtext">{t("featuredSub")}</p>
          </div>
          <Link
            href="/store"
            className="inline-flex items-center gap-1 text-sm font-semibold text-cobalt hover:text-cobalt-hover"
          >
            {t("viewAll")}
          </Link>
        </div>

        {products.length === 0 ? (
          <div className="neu p-10 text-center">
            <p className="text-sm text-mutedtext">{t("emptyFeatured")}</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
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
