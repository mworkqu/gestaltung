import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowRight, MessageCircle, Printer } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Ltr } from "@/components/ltr-isolate";
import { BuyForClass, RequestInvoiceButton, type ClassCartRow } from "@/components/schools/buy-for-class";
import { CopyCodeButton } from "@/components/schools/class-row-actions";
import { getContactPhone } from "@/lib/contact-phone-server";
import { whatsappLink } from "@/lib/contact-phone";
import { createClient } from "@/lib/supabase/server";
import { getSchoolPricing } from "@/lib/store/public-catalog";
import { SITE_URL } from "@/lib/seo";
import { joinUrl } from "@/lib/schools/join-code";
import {
  classPartsPlan,
  classPartsSummary,
  type ClassPartsProduct,
  type ClassTeamDoc,
} from "@/lib/schools/class-parts";
import { FLOW, furthestStep } from "@/lib/studio/client/steps";
import { studioLibrary } from "@/lib/studio/library/remote";
import { linkedPrices } from "@/lib/studio/server/quote";
import { parseStudioDoc, type StudioDoc } from "@/lib/studio/schema";
import { cn } from "@/lib/utils";
import { asLocale } from "@/lib/locale";
import { isMissing } from "../missing";

type ClassRow = { id: string; name: string; school_name: string; join_code: string; archived: boolean };
type TeamRow = { id: string; team_name: string; project_id: string };

const money = (n: number) => n.toFixed(2);

export default async function ClassPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const lang = asLocale(locale);
  const isRtl = lang === "ar";
  const supabase = await createClient();

  const [t, pricing, phone] = await Promise.all([
    getTranslations("SchoolClasses"),
    getSchoolPricing(),
    getContactPhone(),
  ]);

  const { data: classData, error: classError } = await supabase
    .from("school_classes")
    .select("id, name, school_name, join_code, archived")
    .eq("id", id)
    .maybeSingle();

  // Before 0096 the table does not exist: say so instead of a 500 or a 404.
  if (isMissing(classError)) {
    return (
      <div className="page-stack">
        <h1 className="title-page">{t("heading")}</h1>
        <section className="neu card-pad">
          <p className="text-sm text-mutedtext">{t("errRunMigration")}</p>
        </section>
      </div>
    );
  }
  if (!classData) notFound();
  const klass = classData as ClassRow;

  // Teams of this class (RLS: only the teacher's own), oldest first.
  const { data: teamData } = await supabase
    .from("class_teams")
    .select("id, team_name, project_id")
    .eq("class_id", id)
    .order("created_at", { ascending: true });
  const teams = (teamData ?? []) as TeamRow[];
  const projectIds = teams.map((x) => x.project_id);

  // Their projects: readable thanks to the 0096 projects_select_class_teacher
  // policy (read-only by design).
  const docs = new Map<string, StudioDoc | null>();
  const names = new Map<string, string>();
  if (projectIds.length > 0) {
    const { data: projectRows } = await supabase.from("projects").select("id, name, studio").in("id", projectIds);
    for (const p of (projectRows ?? []) as { id: string; name: string | null; studio: unknown }[]) {
      docs.set(p.id, parseStudioDoc(p.studio));
      names.set(p.id, p.name ?? "");
    }
  }

  // Credits used per team: the teacher owns every 'spend:<project_id>' row.
  const spendPerProject = new Map<string, number>();
  if (projectIds.length > 0) {
    const { data: ledger, error: ledgerError } = await supabase
      .from("credits_ledger")
      .select("reason, delta")
      .in("reason", projectIds.map((p) => `spend:${p}`))
      .lt("delta", 0);
    if (ledgerError && !isMissing(ledgerError))
      console.error("[schools] credits_ledger read failed:", ledgerError.message);
    for (const row of (ledger ?? []) as { reason: string; delta: number }[]) {
      const projectId = row.reason.slice("spend:".length);
      spendPerProject.set(projectId, (spendPerProject.get(projectId) ?? 0) + 1);
    }
  }

  // ── The class parts order ────────────────────────────────────────────────
  const classTeams: ClassTeamDoc[] = teams.map((x) => ({
    teamId: x.id,
    teamName: x.team_name,
    projectId: x.project_id,
    doc: docs.get(x.project_id) ?? null,
  }));

  const lib = await studioLibrary().catch(() => null);
  const getPart = (partId: string) => lib?.getPart(partId);

  // Prices through the established path (lib/studio/server/quote linkedPrices),
  // one document at a time, merged into one map.
  const prices = new Map<string, number>();
  for (const team of classTeams) {
    const found = await linkedPrices(supabase, team.doc, getPart).catch(() => new Map<string, number>());
    for (const [sku, price] of found) prices.set(sku, price);
  }

  // The listings themselves: the cart needs the row id, the pack maths the
  // pack size and the minimum order.
  const products = new Map<string, ClassPartsProduct>();
  const productIds = new Map<string, string>();
  if (prices.size > 0) {
    const { data: partRows } = await supabase
      .from("parts")
      .select("id, sku, name, pack_size, min_order_qty")
      .in("sku", [...prices.keys()])
      .eq("is_published", true)
      .is("merged_into", null);
    for (const p of (partRows ?? []) as (ClassPartsProduct & { id: string })[]) {
      products.set(p.sku, p);
      productIds.set(p.sku, p.id);
    }
  }

  const plan = classPartsPlan(classTeams, prices, { getPart, products, locale: lang });
  const summary = classPartsSummary(plan);
  const perTeam = new Map(plan.teams.map((x) => [x.teamId, x]));

  const cartRows: ClassCartRow[] = plan.lines.flatMap((line) => {
    const productId = productIds.get(line.sku);
    if (!productId) return [];
    return [
      {
        productId,
        sku: line.sku,
        minOrderQty: Math.max(1, Math.trunc(Number(products.get(line.sku)?.min_order_qty) || 1)),
        packs: line.packs,
      },
    ];
  });

  const link = joinUrl(SITE_URL, klass.join_code, "ar");
  const buyHref = whatsappLink(
    phone,
    t("buyCreditsMessage", {
      classCredits: String(pricing.class_pack.credits),
      classQar: String(pricing.class_pack.qar),
      teamCredits: String(pricing.team_pack.credits),
      teamQar: String(pricing.team_pack.qar),
    }),
  );
  const arrow = cn("h-4 w-4", isRtl && "-scale-x-100");

  return (
    <div className="page-stack">
      <header className="space-y-3">
        <Link
          href="/schools/classes"
          className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-cobalt hover:text-cobalt-hover"
        >
          <ArrowRight className={cn("h-4 w-4", !isRtl && "-scale-x-100")} aria-hidden />
          {t("backToClasses")}
        </Link>
        <h1 className="title-page break-words">
          {t("classHeading", { name: klass.name, school: klass.school_name })}
        </h1>
      </header>

      {/* The join code and the link students type */}
      <section className="neu card-pad">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="min-w-0 space-y-2">
            <h2 className="title-section">{t("codeLabel")}</h2>
            <Ltr>
              <span className="block font-mono text-3xl font-extrabold tracking-[0.3em] text-heading">
                {klass.join_code}
              </span>
            </Ltr>
            <CopyCodeButton code={klass.join_code} />
          </div>
          <div className="min-w-0 space-y-2">
            <h2 className="title-section">{t("joinLink")}</h2>
            <Ltr>
              <a
                href={link}
                className="block break-all text-sm font-semibold text-cobalt hover:text-cobalt-hover"
                target="_blank"
                rel="noopener noreferrer"
              >
                {link}
              </a>
            </Ltr>
            <Link
              href={`/schools/classes/${klass.id}/sheet`}
              className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-cobalt hover:text-cobalt-hover"
            >
              <Printer className="h-4 w-4" strokeWidth={1.5} aria-hidden />
              {t("sheet")}
            </Link>
          </div>
        </div>
      </section>

      {/* Teams */}
      <section className="neu card-pad">
        <h2 className="mb-6 title-section">{t("teamsHeading")}</h2>
        {teams.length === 0 ? (
          <p className="text-sm text-mutedtext">{t("teamsEmpty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-borderstrong/60 text-start">
                  <th className="px-3 py-2 text-start text-xs font-semibold text-mutedtext">{t("colTeam")}</th>
                  <th className="px-3 py-2 text-start text-xs font-semibold text-mutedtext">{t("colStep")}</th>
                  <th className="px-3 py-2 text-start text-xs font-semibold text-mutedtext">{t("colParts")}</th>
                  <th className="px-3 py-2 text-start text-xs font-semibold text-mutedtext">{t("colCredits")}</th>
                  <th className="px-3 py-2 text-start text-xs font-semibold text-mutedtext">
                    <span className="sr-only">{t("openTeam")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {teams.map((team) => {
                  const doc = docs.get(team.project_id) ?? null;
                  const step = doc ? FLOW[furthestStep(doc, 0)] : null;
                  const parts = perTeam.get(team.id);
                  return (
                    <tr key={team.id} className="border-b border-borderstrong/30 last:border-0">
                      <td className="px-3 py-3 align-top">
                        <span className="font-semibold text-heading">{team.team_name}</span>
                        {names.get(team.project_id) && (
                          <span className="block text-xs text-mutedtext">{names.get(team.project_id)}</span>
                        )}
                      </td>
                      <td className="px-3 py-3 align-top text-body">{step ? t(`step_${step}`) : t("stepOpen")}</td>
                      <td className="px-3 py-3 align-top text-body">
                        {parts && parts.partCount > 0
                          ? t("partsSummary", {
                              count: String(parts.partCount),
                              total: money(parts.goodsQar),
                            })
                          : t("partsNone")}
                      </td>
                      <td className="px-3 py-3 align-top text-body">
                        {t("creditsUsed", { count: String(spendPerProject.get(team.project_id) ?? 0) })}
                      </td>
                      <td className="px-3 py-3 align-top">
                        <Link
                          href={`/schools/classes/${klass.id}/teams/${team.id}`}
                          className="inline-flex min-h-11 items-center gap-1 font-semibold text-cobalt hover:text-cobalt-hover"
                        >
                          {t("openTeam")}
                          <ArrowRight className={cn(arrow, "shrink-0")} aria-hidden />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* One order for the whole class */}
      <section className="neu card-pad">
        <div className="mb-6 space-y-1">
          <h2 className="title-section">{t("buyAll")}</h2>
          <p className="text-sm text-body">
            {summary.lineCount > 0
              ? t("partsSummary", { count: String(summary.partCount), total: money(summary.goodsQar) })
              : t("buyAllEmpty")}
          </p>
          {plan.weSource.length > 0 && (
            <p className="text-xs leading-relaxed text-mutedtext">
              {plan.weSource.map((x) => x.name).join(" · ")}
            </p>
          )}
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <BuyForClass locale={lang} classId={klass.id} rows={cartRows} pieces={summary.partCount} />
          <RequestInvoiceButton locale={lang} classId={klass.id} />
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-4">
          <Button asChild size="lg" variant="secondary" className="w-full rounded-full sm:w-auto">
            <a href={buyHref} target="_blank" rel="noopener noreferrer">
              <MessageCircle className="h-4 w-4" strokeWidth={1.5} aria-hidden />
              {t("buyCredits")}
            </a>
          </Button>
        </div>
      </section>
    </div>
  );
}
