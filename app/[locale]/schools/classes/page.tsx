import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowRight, GraduationCap, MessageCircle, Printer, Wallet } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Ltr } from "@/components/ltr-isolate";
import { ClassCreateForm } from "@/components/schools/class-create-form";
import { ClassRowActions } from "@/components/schools/class-row-actions";
import { getContactPhone } from "@/lib/contact-phone-server";
import { whatsappLink } from "@/lib/contact-phone";
import { createClient } from "@/lib/supabase/server";
import { getSchoolPricing } from "@/lib/store/public-catalog";
import { cn } from "@/lib/utils";

// Private: the teacher's own classes. The layout holds the auth gate and
// force-dynamic.

type ClassRow = { id: string; name: string; school_name: string; join_code: string; archived: boolean };

type PgError = { code?: string; message?: string } | null;

/** The relation or function does not exist yet (0096 not run). */
function isMissing(e: PgError): boolean {
  if (!e) return false;
  const code = e.code ?? "";
  if (code === "42P01" || code === "PGRST202" || code === "PGRST205" || code === "42883") return true;
  return /could not find the (?:function|table)|does not exist/i.test(e.message ?? "");
}

export default async function SchoolClassesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const isRtl = locale === "ar";
  const supabase = await createClient();

  const [t, pricing, phone] = await Promise.all([
    getTranslations("SchoolClasses"),
    getSchoolPricing(),
    getContactPhone(),
  ]);

  // Classes under RLS (the teacher's own), newest first.
  const { data: classData, error: classError } = await supabase
    .from("school_classes")
    .select("id, name, school_name, join_code, archived")
    .order("created_at", { ascending: false });
  const notReady = isMissing(classError);
  const classes = (classData ?? []) as ClassRow[];

  // Teams per class: one read, grouped here (no SQL aggregate needed).
  const counts = new Map<string, number>();
  if (classes.length > 0) {
    const { data: teamData } = await supabase
      .from("class_teams")
      .select("class_id")
      .in("class_id", classes.map((c) => c.id));
    for (const row of (teamData ?? []) as { class_id: string }[])
      counts.set(row.class_id, (counts.get(row.class_id) ?? 0) + 1);
  }

  // The teacher's own balance (0042 credit_summary); null before 0042 or on error.
  const { data: summaryData, error: summaryError } = await supabase.rpc("credit_summary");
  if (summaryError && !isMissing(summaryError))
    console.error("[schools] credit_summary failed:", summaryError.message);
  const summary = (summaryData ?? null) as { wiring?: number; cad?: number } | null;
  const wiring = String(Math.max(0, Math.trunc(Number(summary?.wiring) || 0)));
  const cad = String(Math.max(0, Math.trunc(Number(summary?.cad) || 0)));

  const buyHref = whatsappLink(
    phone,
    t("buyCreditsMessage", {
      classCredits: String(pricing.class_pack.credits),
      classQar: String(pricing.class_pack.qar),
      teamCredits: String(pricing.team_pack.credits),
      teamQar: String(pricing.team_pack.qar),
    }),
  );

  const open = classes.filter((c) => !c.archived);
  const archived = classes.filter((c) => c.archived);
  const arrow = cn("h-4 w-4", isRtl && "-scale-x-100");

  // A plain render helper (not a nested component) so it can read `t` and the counts.
  const classList = (rows: ClassRow[]) => (
    <ul className="grid gap-4">
      {rows.map((c) => (
          <li key={c.id} className="min-w-0 tile">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 space-y-1">
                <h3 className="title-card break-words">{t("classHeading", { name: c.name, school: c.school_name })}</h3>
                <p className="text-xs text-mutedtext">
                  {t("codeLabel")}:{" "}
                  <Ltr>
                    <span className="font-mono text-sm font-bold tracking-[0.22em] text-heading">{c.join_code}</span>
                  </Ltr>
                </p>
                <p className="text-xs text-mutedtext">{t("teamCount", { count: String(counts.get(c.id) ?? 0) })}</p>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <Link
                  href={`/schools/classes/${c.id}`}
                  className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-cobalt hover:text-cobalt-hover"
                >
                  {t("open")}
                  <ArrowRight className={cn(arrow, "shrink-0")} aria-hidden />
                </Link>
                <Link
                  href={`/schools/classes/${c.id}/sheet`}
                  className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-cobalt hover:text-cobalt-hover"
                >
                  <Printer className="h-4 w-4" strokeWidth={1.5} aria-hidden />
                  {t("sheet")}
                </Link>
              <ClassRowActions locale={locale} classId={c.id} archived={c.archived} />
            </div>
          </div>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="page-stack">
      <header className="space-y-2">
        <h1 className="flex items-center gap-2 title-page">
          <GraduationCap className="h-7 w-7 shrink-0 text-cobalt" strokeWidth={1.5} aria-hidden />
          {t("heading")}
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-body sm:text-base">{t("intro")}</p>
      </header>

      {/* Credits */}
      <section className="neu card-pad">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-2">
            <h2 className="flex items-center gap-2 title-section">
              <Wallet className="h-5 w-5 text-cobalt" strokeWidth={1.5} aria-hidden />
              {t("balanceHeading")}
            </h2>
            <p className="text-base font-semibold text-heading">{t("balanceText", { wiring, cad })}</p>
            <p className="max-w-xl text-sm leading-relaxed text-mutedtext">{t("balanceNote")}</p>
          </div>
          <Button asChild size="lg" className="w-full shrink-0 rounded-full sm:w-auto">
            <a href={buyHref} target="_blank" rel="noopener noreferrer">
              <MessageCircle className="h-4 w-4" strokeWidth={1.5} aria-hidden />
              {t("buyCredits")}
            </a>
          </Button>
        </div>
      </section>

      {/* Open classes */}
      <section className="neu card-pad">
        {notReady ? (
          <p className="text-sm text-mutedtext">{t("errRunMigration")}</p>
        ) : open.length === 0 ? (
          <p className="text-sm text-mutedtext">{t("empty")}</p>
        ) : (
          classList(open)
        )}
      </section>

      {archived.length > 0 && (
        <section className="neu card-pad">
          <h2 className="mb-6 title-section">{t("archivedHeading")}</h2>
          {classList(archived)}
        </section>
      )}

      {/* Create */}
      <section className="neu card-pad">
        <h2 className="mb-6 title-section">{t("createHeading")}</h2>
        <ClassCreateForm locale={locale} />
      </section>
    </div>
  );
}
