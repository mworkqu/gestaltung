import { getTranslations, setRequestLocale } from "next-intl/server";
import { Space_Grotesk, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";

import type { Part, StockStatus } from "@/lib/supabase/types";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatPrice, partName } from "@/lib/parts/format";
import { LogoMark } from "@/components/logo-mark";
import { LandingHeader } from "@/components/store-landing/landing-header";
import { CategoryChips } from "@/components/store-landing/category-chips";
import { FeaturedAddButton } from "@/components/store-landing/featured-add-button";
import { CallbackForm } from "@/components/store-landing/callback-form";
import { STORE_THEME_KEY } from "@/components/store-landing/theme-toggle";
import type { Locale } from "@/i18n/routing";

// Design-handoff fonts, scoped to the landing via CSS variables consumed by
// the .sl-sans / .sl-heading / .sl-mono stacks in globals.css.
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-space-grotesk",
  display: "swap",
});
const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-sans",
  display: "swap",
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
  display: "swap",
});

// Featured products must reflect admin publish toggles immediately.
export const dynamic = "force-dynamic";

// Store-first metadata for the homepage (overrides the sitewide default,
// which mentions the inventory platform — banned on the store landing).
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "StoreLanding" });
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
  };
}

// Runs before paint: apply the saved theme, or on a mobile device follow the
// phone's theme. Desktop with no saved choice stays light. Kept dependency-free
// so it can be inlined as a string.
const THEME_INIT_SCRIPT = `(function(){try{var r=document.currentScript.parentElement;var s=localStorage.getItem('${STORE_THEME_KEY}');var d;if(s==='dark'||s==='light'){d=s==='dark';}else{var m=window.matchMedia('(pointer:coarse)').matches||window.matchMedia('(max-width:767px)').matches;d=m&&window.matchMedia('(prefers-color-scheme:dark)').matches;}if(d)r.classList.add('sl-dark');}catch(e){}})();`;

const STOCK_TOKENS: Record<StockStatus, { fg: string; bg: string }> = {
  in_stock: { fg: "var(--sl-ok)", bg: "var(--sl-ok-bg)" },
  low_stock: { fg: "var(--sl-warn)", bg: "var(--sl-warn-bg)" },
  out_of_stock: { fg: "var(--sl-err)", bg: "var(--sl-err-bg)" },
};

export default async function StoreLandingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("StoreLanding");
  const tBrand = await getTranslations("Brand");
  const isRtl = locale === "ar";

  // Published parts via the anon-safe RLS read; newest first as "featured".
  // The homepage must never crash if Supabase env is absent (fresh local
  // checkout) — fall back to the empty featured state instead.
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

  const stockLabel: Record<StockStatus, string> = {
    in_stock: t("inStock"),
    low_stock: t("lowStock"),
    out_of_stock: t("outOfStock"),
  };

  const categories = [
    t("cat1"),
    t("cat2"),
    t("cat3"),
    t("cat4"),
    t("cat5"),
    t("cat6"),
  ];

  return (
    <div
      className={`store-landing sl-sans min-h-screen ${spaceGrotesk.variable} ${plexSans.variable} ${plexMono.variable}`}
    >
      {/* Pre-paint theme init (light default; mobile follows the device). */}
      <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />

      <LandingHeader locale={locale as Locale} />

      {/* ── Hero ── */}
      <section
        className="border-b border-[var(--sl-border2)] px-[18px] pb-[26px] pt-7 md:px-10 md:pb-10 md:pt-[46px]"
        style={{
          background:
            "radial-gradient(120% 140% at 100% 0%, var(--sl-hero-glow) 0%, transparent 55%)",
        }}
      >
        <div className="max-w-[760px]">
          <span className="sl-mono text-xs uppercase tracking-[1px] text-[var(--sl-accent)]">
            {t("tagline")}
          </span>
          <h1 className="sl-heading mb-[22px] mt-3 text-[28px] font-bold leading-[1.1] tracking-[-0.5px] text-[var(--sl-heading)] [text-wrap:balance] md:text-[42px]">
            {t("heroTitle")}
          </h1>
          <form
            action={`/${locale}/store`}
            className="flex max-w-[560px] items-stretch gap-2.5"
          >
            <div className="flex flex-1 items-center gap-2.5 rounded-[10px] border border-[var(--sl-search-border)] bg-[var(--sl-search-bg)] px-3.5 text-[var(--sl-faint)]">
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                className="shrink-0"
                aria-hidden
              >
                <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
                <line
                  x1="11"
                  y1="11"
                  x2="14.5"
                  y2="14.5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
              </svg>
              <input
                name="q"
                placeholder={t("searchPh")}
                className="w-full flex-1 border-none bg-transparent py-3 text-sm text-[var(--sl-heading)] outline-none placeholder:text-[var(--sl-faint)]"
              />
            </div>
            <button
              type="submit"
              className="sl-heading rounded-[10px] bg-[var(--sl-accent)] px-[22px] text-sm font-semibold text-[var(--sl-accent-ink)]"
            >
              {t("searchBtn")}
            </button>
          </form>
          <CategoryChips labels={categories} />
        </div>
      </section>

      {/* ── Featured products ── */}
      <section className="px-[18px] py-[26px] md:p-10">
        <div className="mb-[22px] flex items-end justify-between gap-4">
          <div>
            <h2 className="sl-heading m-0 text-xl font-semibold text-[var(--sl-heading)] md:text-[26px]">
              {t("featured")}
            </h2>
            <p className="mb-0 mt-1.5 text-[13px] text-[var(--sl-muted)]">
              {t("featuredSub")}
            </p>
          </div>
          <Link
            href="/store"
            className="whitespace-nowrap text-[13px] text-[var(--sl-accent)]"
          >
            {t("viewAll")}
          </Link>
        </div>

        {products.length === 0 ? (
          <p className="sl-mono text-[13px] text-[var(--sl-faint)]">
            {t("emptyFeatured")}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {products.map((part) => {
              const spec =
                [part.material, part.standard].filter(Boolean).join(" · ") ||
                part.category;
              const stock = STOCK_TOKENS[part.stock_status];
              return (
                <div
                  key={part.id}
                  className="flex flex-col overflow-hidden rounded-xl border border-[var(--sl-border)] bg-[var(--sl-panel)]"
                >
                  <Link
                    href={`/store/${part.sku}`}
                    className="relative flex h-[116px] items-end p-2.5 md:h-40"
                    style={{
                      background:
                        "repeating-linear-gradient(135deg, var(--sl-stripe1) 0, var(--sl-stripe1) 9px, var(--sl-stripe2) 9px, var(--sl-stripe2) 18px)",
                    }}
                  >
                    {part.image_url ? (
                      // Admin-pasted arbitrary hosts → plain <img>, same as the
                      // store catalog (next/image needs configured domains).
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={part.image_url}
                        alt={partName(part, locale)}
                        loading="lazy"
                        className="absolute inset-0 h-full w-full object-cover"
                      />
                    ) : (
                      <span className="sl-mono text-[11px] text-[var(--sl-cap)]">
                        {"// "}
                        {part.sku.toLowerCase()}
                      </span>
                    )}
                    <span
                      className="absolute top-2.5 rounded-md px-2 py-[3px] text-[11px] font-medium ltr:right-2.5 rtl:left-2.5"
                      style={{ background: stock.bg, color: stock.fg }}
                    >
                      {stockLabel[part.stock_status]}
                    </span>
                  </Link>
                  <div className="flex flex-1 flex-col gap-[7px] p-3.5 pb-[15px]">
                    <span className="sl-mono text-[11px] tracking-[0.3px] text-[var(--sl-faint)]">
                      {spec}
                    </span>
                    <Link
                      href={`/store/${part.sku}`}
                      className="text-sm font-medium leading-[1.35] text-[var(--sl-heading)]"
                    >
                      {partName(part, locale)}
                    </Link>
                    <div className="mt-auto flex items-center justify-between gap-2 pt-2">
                      <span className="sl-mono text-[15px] font-medium text-[var(--sl-accent)]">
                        {formatPrice(part.unit_price, locale)}
                      </span>
                      <FeaturedAddButton part={part} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Custom manufacturing strip (the ONE Design button) ── */}
      <section className="px-[18px] pb-[18px] md:px-10 md:pb-10">
        <div
          className="relative flex flex-col items-stretch overflow-hidden rounded-2xl border border-[var(--sl-border)] md:flex-row"
          style={{ background: "var(--sl-strip-bg)" }}
        >
          <div className="absolute top-0 h-full w-1 bg-[var(--sl-accent)] ltr:left-0 rtl:right-0" />
          <div className="flex-1 px-5 py-[26px] md:px-11 md:py-10">
            <span className="sl-mono text-xs uppercase tracking-[1px] text-[var(--sl-accent)]">
              {t("customKicker")}
            </span>
            <h3 className="sl-heading mb-2.5 mt-3 text-[22px] font-bold leading-[1.15] text-[var(--sl-heading)] md:text-3xl">
              {t("customTitle")}
            </h3>
            <p className="mb-[22px] mt-0 max-w-[440px] text-sm leading-[1.6] text-[var(--sl-body)]">
              {t("customText")}
            </p>
            <div className="flex flex-wrap items-center gap-3.5">
              <Link
                href="/design"
                className="sl-heading flex items-center gap-2 rounded-[10px] bg-[var(--sl-accent)] px-6 py-[13px] text-[15px] font-semibold text-[var(--sl-accent-ink)]"
              >
                {t("customBtn")}
                <span className="text-base">{isRtl ? "←" : "→"}</span>
              </Link>
              <span className="sl-mono text-xs text-[var(--sl-faint)]">
                STL · STEP · DXF · IGES
              </span>
            </div>
          </div>
          <div
            className="flex h-[140px] items-center justify-center border-t border-[var(--sl-border)] md:h-auto md:min-h-[180px] md:w-[300px] md:flex-none md:border-t-0 ltr:md:border-l rtl:md:border-r"
            style={{ background: "var(--sl-art-bg)" }}
          >
            <span className="sl-mono text-xs text-[var(--sl-art-text)]">
              {"// cad-render.step"}
            </span>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="flex flex-col justify-between gap-6 border-t border-[var(--sl-border2)] bg-[var(--sl-foot-bg)] px-[18px] py-7 md:flex-row md:px-10 md:py-9">
        <div className="max-w-[280px]">
          <div className="mb-3 flex items-center gap-2.5">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#0a0e15]">
              <LogoMark
                title={tBrand("name")}
                gradientId="gestaltung-footer-logo"
                className="h-7 w-7"
              />
            </span>
            <span className="sl-heading text-[15px] font-semibold text-[var(--sl-heading)]">
              {tBrand("name")}
            </span>
          </div>
          <p className="sl-mono m-0 whitespace-pre-line text-xs leading-[1.6] text-[var(--sl-faint)]">
            {t("footerText")}
          </p>
        </div>
        <CallbackForm />
      </footer>
    </div>
  );
}
