import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowRight, Bot, Box, CircuitBoard, CloudSun, ListChecks, Sprout, type LucideIcon } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { metaFor } from "@/lib/meta";

export const generateMetadata = metaFor("students");

// Schools and students (P1-02): a secondary entry from the home page and the
// footer, not in the header. Static server component, no client components.
export default async function StudentsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("Students");
  const isRtl = locale === "ar";
  const mono = (extra = "") => cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);
  const arrow = cn("h-4 w-4", isRtl && "-scale-x-100");

  const gets: { key: "get1" | "get2" | "get3"; icon: LucideIcon }[] = [
    { key: "get1", icon: ListChecks },
    { key: "get2", icon: CircuitBoard },
    { key: "get3", icon: Box },
  ];

  // The store search contract (lib/store/catalog.ts STORE_URL_PARAMS): /store?q=...
  const kits: { key: "kit1" | "kit2" | "kit3"; icon: LucideIcon; q: string }[] = [
    { key: "kit1", icon: Bot, q: "line following" },
    { key: "kit2", icon: Sprout, q: "soil moisture" },
    { key: "kit3", icon: CloudSun, q: "DHT" },
  ];

  return (
    <div className="container space-y-6 py-6">
      {/* Hero */}
      <section className="neu animate-fade-up flex flex-col gap-5 p-8 sm:p-10 lg:p-12">
        <span className="inline-flex w-fit items-center gap-2 rounded-full bg-panel px-3 py-1.5 shadow-neu-sm">
          <span className="h-2 w-2 rounded-full bg-cobalt" />
          <span className={mono("text-[10px] text-mutedtext")}>{t("kicker")}</span>
        </span>
        <h1 className="max-w-3xl text-balance text-[2.25rem] font-extrabold leading-[1.05] tracking-tight text-heading sm:text-5xl lg:text-[3rem]">
          {t("heading")}
        </h1>
        <p className="max-w-2xl text-base leading-relaxed text-body sm:text-lg">{t("sub")}</p>
        <div className="flex flex-col items-start gap-1 sm:flex-row sm:items-center sm:gap-6">
          <Button asChild size="lg" className="w-full rounded-full sm:w-auto">
            <Link href="/projects/new">{t("ctaPrimary")}</Link>
          </Button>
          <Link
            href="/store"
            className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-cobalt hover:text-cobalt-hover"
          >
            {t("ctaSecondary")}
            <ArrowRight className={arrow} />
          </Link>
        </div>
      </section>

      {/* What you get */}
      <section className="neu animate-fade-up delay-1 p-8 sm:p-10">
        <h2 className="mb-6 text-2xl font-extrabold tracking-tight text-heading">{t("getHeading")}</h2>
        <ul className="grid gap-5 lg:grid-cols-3">
          {gets.map(({ key, icon: Icon }) => (
            <li key={key} className="min-w-0 rounded-2xl bg-panel p-5 shadow-neu-sm">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface text-cobalt shadow-neu-sm">
                <Icon className="h-5 w-5" strokeWidth={1.5} aria-hidden />
              </span>
              <h3 className="mt-4 text-base font-bold text-heading">{t(`${key}Title`)}</h3>
              <p className="mt-2 text-sm leading-relaxed text-mutedtext">{t(`${key}Text`)}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* Kits: three links into the store search */}
      <section className="neu animate-fade-up delay-2 p-8 sm:p-10">
        <div className="mb-6 space-y-1">
          <h2 className="text-2xl font-extrabold tracking-tight text-heading">{t("kitsHeading")}</h2>
          <p className="max-w-2xl text-sm leading-relaxed text-body">{t("kitsIntro")}</p>
        </div>
        <ul className="grid gap-4 sm:grid-cols-3">
          {kits.map(({ key, icon: Icon, q }) => (
            <li key={key}>
              <Link
                href={{ pathname: "/store", query: { q } }}
                className="flex min-h-11 items-center gap-3 rounded-2xl bg-panel p-4 shadow-neu-sm transition-colors hover:text-cobalt"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface text-cobalt shadow-neu-sm">
                  <Icon className="h-5 w-5" strokeWidth={1.5} aria-hidden />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-sm font-bold text-heading">{t(key)}</span>
                  <span className="text-xs text-mutedtext">{t("kitSearch")}</span>
                </span>
                <ArrowRight className={cn(arrow, "shrink-0 text-cobalt")} aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* Teachers */}
      <section className="neu animate-fade-up delay-2 flex flex-col gap-5 p-8 sm:flex-row sm:items-center sm:justify-between sm:p-10">
        <div className="max-w-2xl space-y-2">
          <h2 className="text-2xl font-extrabold tracking-tight text-heading">{t("teachersHeading")}</h2>
          <p className="text-sm leading-relaxed text-body sm:text-base">{t("teachersText")}</p>
        </div>
        <Button asChild size="lg" className="w-full shrink-0 rounded-full sm:w-auto">
          <Link href="/contact?kind=school">{t("teachersCta")}</Link>
        </Button>
      </section>
    </div>
  );
}
