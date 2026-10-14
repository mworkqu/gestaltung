import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { GraduationCap, Link2Off } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { RadarChart } from "@/components/cad-champions/results/radar-chart";
import { Button, EmptyState, PageHeader, StatusChip } from "@/components/cad-champions/ui";
import { formatNumber } from "@/lib/cad-champions/format";
import { Ltr } from "@/lib/cad-champions/ltr";
import { CC_ROBOTS } from "@/lib/cad-champions/metadata";
import { ccPath, isCcLocale } from "@/lib/cad-champions/routes";
import { createClient } from "@/lib/supabase/server";

// Public share page (Prompt 7 Step D). Shows ONLY first name, band and the
// skill map, via the SECURITY DEFINER read cc_shared_result(token) (0081),
// which returns nothing once the student turns sharing off. noindex.

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string; token: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isCcLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: "CC.results.sharePage" });
  return { title: t("metaTitle"), robots: CC_ROBOTS };
}

type Shared = {
  first_name: string | null;
  first_name_ar: string | null;
  band: string | null;
  areas: { id: number; percent: number | null; level: number | null; assessed: boolean }[];
};

const BANDS = ["beginner", "developing", "competitive", "competition_ready"] as const;

async function readShared(token: string): Promise<Shared | null> {
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(token)) return null;
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return null;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("cc_shared_result", { p_token: token });
    if (error || !data) return null;
    return data as Shared;
  } catch {
    return null;
  }
}

export default async function CcSharedResultPage({ params }: Props) {
  const { locale, token } = await params;
  if (!isCcLocale(locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "CC.results.sharePage" });
  const tMap = await getTranslations({ locale, namespace: "CC.results.skillMap" });
  const tShort = await getTranslations({ locale, namespace: "CC.results.areaShort" });
  const tBand = await getTranslations({ locale, namespace: "CC.results.band" });
  const shared = await readShared(token);

  const cta = (
    <Button asChild>
      <Link href={ccPath(locale, "/")}>{t("cta")}</Link>
    </Button>
  );

  if (!shared) {
    return (
      <div className="container space-y-6 py-8 sm:py-12">
        <PageHeader title={t("metaTitle")} purpose={t("purpose")} />
        <EmptyState icon={Link2Off} title={t("notFoundTitle")} description={t("notFoundText")} action={cta} />
      </div>
    );
  }

  const name = (locale === "ar" ? shared.first_name_ar || shared.first_name : shared.first_name || shared.first_name_ar) ?? null;
  const band = BANDS.find((b) => b === shared.band) ?? null;
  const areas = [1, 2, 3, 4, 5, 6].map((id) => {
    const a = shared.areas.find((x) => Number(x.id) === id);
    return { id, label: tShort(String(id) as "1"), percent: a && a.assessed && a.percent != null ? Number(a.percent) : null };
  });

  return (
    <div className="container space-y-6 py-8 sm:py-12">
      <PageHeader title={name ? t("heading", { name }) : t("headingNoName")} purpose={t("purpose")} />
      <section className="neu max-w-3xl space-y-4 p-6 sm:p-8" aria-label={tMap("title")}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-body">{t("band")}</span>
          {band ? (
            <StatusChip tone="info" icon={GraduationCap}>
              {tBand(`${band}.name`)}
            </StatusChip>
          ) : null}
        </div>
        <div className="flex justify-center">
          <RadarChart axes={areas} label={tMap("chartLabel")} notAssessed={tMap("notAssessedShort")} rtl={locale === "ar"} />
        </div>
        <ul className="grid gap-2 sm:grid-cols-2">
          {areas.map((a) => (
            <li key={a.id} className="tile flex items-center justify-between gap-2 text-sm">
              <span className="font-semibold text-ink">{a.label}</span>
              <span className={a.percent == null ? "text-mutedtext" : "font-bold text-ink"}>
                {a.percent == null ? tMap("notAssessedShort") : <Ltr>{`${formatNumber(Math.round(a.percent), locale)}%`}</Ltr>}
              </span>
            </li>
          ))}
        </ul>
        <div>{cta}</div>
      </section>
    </div>
  );
}
