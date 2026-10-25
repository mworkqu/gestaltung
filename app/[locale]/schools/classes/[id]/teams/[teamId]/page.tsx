import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowRight, Check, Circle, ShieldCheck } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { TeamCommentForm } from "@/components/schools/team-comment-form";
import { createClient } from "@/lib/supabase/server";
import {
  classPartsPlan,
  type ClassPartsProduct,
  type ClassTeamDoc,
} from "@/lib/schools/class-parts";
import { FLOW, stepDone } from "@/lib/studio/client/steps";
import { studioLibrary } from "@/lib/studio/library/remote";
import { linkedPrices } from "@/lib/studio/server/quote";
import { parseStudioDoc, type StudioDoc } from "@/lib/studio/schema";
import { cn } from "@/lib/utils";
import { asLocale } from "@/lib/locale";
import { isMissing } from "../../../missing";

type TeamRow = { id: string; class_id: string; team_name: string; project_id: string };
type CommentRow = { id: string; body: string; created_at: string };

export default async function ClassTeamPage({
  params,
}: {
  params: Promise<{ locale: string; id: string; teamId: string }>;
}) {
  const { locale, id, teamId } = await params;
  setRequestLocale(locale);

  const lang = asLocale(locale);
  const isRtl = lang === "ar";
  const supabase = await createClient();

  const [t, tSafety] = await Promise.all([getTranslations("SchoolClasses"), getTranslations("SchoolSafety")]);

  const { data: teamData, error: teamError } = await supabase
    .from("class_teams")
    .select("id, class_id, team_name, project_id")
    .eq("id", teamId)
    .eq("class_id", id)
    .maybeSingle();

  if (isMissing(teamError)) {
    return (
      <div className="page-stack">
        <h1 className="title-page">{t("teamsHeading")}</h1>
        <section className="neu card-pad">
          <p className="text-sm text-mutedtext">{t("errRunMigration")}</p>
        </section>
      </div>
    );
  }
  if (!teamData) notFound();
  const team = teamData as TeamRow;

  // The team's project: readable (never writable) through the 0096
  // projects_select_class_teacher policy.
  const { data: projectRow } = await supabase
    .from("projects")
    .select("id, name, studio")
    .eq("id", team.project_id)
    .maybeSingle();
  const project = (projectRow ?? null) as { name: string | null; studio: unknown } | null;
  const doc: StudioDoc | null = parseStudioDoc(project?.studio);

  // Their parts list, through the same planner the class order uses (one team).
  const lib = await studioLibrary().catch(() => null);
  const getPart = (partId: string) => lib?.getPart(partId);
  const prices = await linkedPrices(supabase, doc, getPart).catch(() => new Map<string, number>());
  const products = new Map<string, ClassPartsProduct>();
  if (prices.size > 0) {
    const { data: partRows } = await supabase
      .from("parts")
      .select("sku, name, pack_size, min_order_qty")
      .in("sku", [...prices.keys()])
      .eq("is_published", true)
      .is("merged_into", null);
    for (const p of (partRows ?? []) as ClassPartsProduct[]) products.set(p.sku, p);
  }
  const one: ClassTeamDoc = { teamId: team.id, teamName: team.team_name, projectId: team.project_id, doc };
  const plan = classPartsPlan([one], prices, { getPart, products, locale: lang });
  const needs = plan.teams[0]?.needs ?? [];

  // The teacher's own comments on this team.
  const { data: commentData, error: commentError } = await supabase
    .from("class_team_comments")
    .select("id, body, created_at")
    .eq("team_id", team.id)
    .order("created_at", { ascending: false });
  if (commentError && !isMissing(commentError))
    console.error("[schools] comments read failed:", commentError.message);
  const comments = (commentData ?? []) as CommentRow[];

  const dateOf = new Intl.DateTimeFormat(isRtl ? "ar-QA-u-nu-latn-ca-gregory" : "en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Qatar",
  });

  return (
    <div className="page-stack">
      <header className="space-y-3">
        <Link
          href={`/schools/classes/${id}`}
          className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-cobalt hover:text-cobalt-hover"
        >
          <ArrowRight className={cn("h-4 w-4", !isRtl && "-scale-x-100")} aria-hidden />
          {t("backToClasses")}
        </Link>
        <h1 className="title-page break-words">
          {t("teamHeading", { team: team.team_name, name: project?.name ?? "" })}
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-body">{t("readOnly")}</p>
        <p className="flex items-center gap-2 text-xs font-semibold text-mutedtext">
          <ShieldCheck className="h-4 w-4 shrink-0 text-cobalt" strokeWidth={1.5} aria-hidden />
          {tSafety("banner")}
        </p>
      </header>

      {/* Steps */}
      <section className="neu card-pad">
        <h2 className="mb-6 title-section">{t("stepsHeading")}</h2>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FLOW.map((step) => {
            const done = stepDone(step, doc);
            return (
              <li key={step} className="flex min-w-0 items-center gap-3 tile p-4">
                {done ? (
                  <Check className="h-5 w-5 shrink-0 text-cobalt" strokeWidth={1.5} aria-hidden />
                ) : (
                  <Circle className="h-5 w-5 shrink-0 text-mutedtext" strokeWidth={1.5} aria-hidden />
                )}
                <span className="flex min-w-0 flex-col">
                  <span className="text-sm font-bold text-heading">{t(`step_${step}`)}</span>
                  <span className="text-xs text-mutedtext">{done ? t("stepDone") : t("stepOpen")}</span>
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      {/* Their parts list */}
      <section className="neu card-pad">
        <h2 className="mb-6 title-section">{t("partsListHeading")}</h2>
        {needs.length === 0 ? (
          <p className="text-sm text-mutedtext">{t("partsNone")}</p>
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {needs.map((need) => (
              <li key={need.partId} className="flex min-w-0 items-center justify-between gap-3 tile p-4">
                <span className="min-w-0 break-words text-sm font-semibold text-heading">{need.name}</span>
                <span className="shrink-0 text-sm tabular-nums text-mutedtext">× {need.quantity}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* The teacher's comments */}
      <section className="neu card-pad">
        <h2 className="mb-6 title-section">{t("commentHeading")}</h2>
        <TeamCommentForm locale={lang} teamId={team.id} />
        {comments.length === 0 ? (
          <p className="mt-6 text-sm text-mutedtext">{t("commentEmpty")}</p>
        ) : (
          <ul className="mt-6 grid gap-3">
            {comments.map((comment) => (
              <li key={comment.id} className="min-w-0 tile p-4">
                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-body">{comment.body}</p>
                <p className="mt-2 text-xs text-mutedtext">{dateOf.format(new Date(comment.created_at))}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
