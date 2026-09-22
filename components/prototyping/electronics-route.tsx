"use client";

// Electronics › how it gets built. The client chooses, before any electronics
// list is made:
//   Prototype (default) — development boards, modules and discrete parts on a
//                         breadboard or perfboard: parts available now.
//   Custom PCB          — a designed board: schematic, layout and fabrication;
//                         slower and costlier, and still prototyped first.
// The analysis may recommend one; it is shown as a recommendation with its
// reason, never as a decision.

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CircleAlert, Cpu, Lightbulb, Loader2, RefreshCw } from "lucide-react";

import { Card, PrimaryButton, SoftButton, Warn } from "@/components/prototyping/ui";
import type { BuildRoute, RouteRecommendation } from "@/lib/prototyping/analysis";
import type { LevelFlag } from "@/lib/prototyping/electronics-rules";
import { cn } from "@/lib/utils";

type BuildError = { code: string; problems?: string[] };

export function BuildRouteCard({
  projectId,
  route,
  builtFor,
  recommendation,
  onRoute,
  onBuilt,
}: {
  projectId: string;
  /** The saved route; null until the client chooses. */
  route: BuildRoute | null;
  /** The route the current electronics list was built for, if any. */
  builtFor: BuildRoute | null;
  recommendation: RouteRecommendation | null;
  onRoute: (r: BuildRoute) => Promise<boolean>;
  onBuilt: () => Promise<void>;
}) {
  const t = useTranslations("Prototyping");
  const locale = useLocale();
  const [pick, setPick] = useState<BuildRoute>(route ?? "prototype");
  const [saving, setSaving] = useState(false);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<BuildError | null>(null);
  const [warning, setWarning] = useState<string[] | null>(null);

  async function choose() {
    setSaving(true);
    setError(null);
    if (!(await onRoute(pick))) setError({ code: "not_ready" });
    setSaving(false);
  }

  async function build() {
    setBuilding(true);
    setError(null);
    setWarning(null);
    try {
      const res = await fetch("/api/bom/electronics", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId, locale }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; problems?: string[]; circuit?: string };
      if (!res.ok) setError({ code: data.error ?? "failed", problems: data.problems });
      else {
        if (data.circuit === "failed") setWarning(data.problems ?? []);
        await onBuilt();
      }
    } catch {
      setError({ code: "failed" });
    }
    setBuilding(false);
  }

  const stale = route && builtFor && builtFor !== route;
  return (
    <Card kicker={t("discipline_electronics")} title={t("routeTitle")} intro={t("routeIntro")}>
      {recommendation && (
        <p className="flex items-start gap-2 rounded-xl bg-panel/60 px-3 py-2 text-[12px] text-heading">
          <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cobalt" />
          <span>
            <span className="font-semibold">{t("routeRecommendation", { route: t(`route_${recommendation.recommended}`) })}</span>{" "}
            {recommendation.reason}
          </span>
        </p>
      )}

      <div role="radiogroup" aria-label={t("routeTitle")} className="grid gap-3 sm:grid-cols-2">
        {(["prototype", "custom_pcb"] as const).map((r) => (
          <button
            key={r}
            type="button"
            role="radio"
            aria-checked={pick === r}
            onClick={() => setPick(r)}
            className={cn(
              "space-y-1 rounded-2xl p-4 text-start transition-shadow",
              pick === r ? "bg-surface shadow-neu-inset ring-2 ring-cobalt/50" : "bg-panel shadow-neu-sm hover:ring-1 hover:ring-cobalt/30"
            )}
          >
            <span className="flex items-center gap-2 text-sm font-bold text-heading">
              {t(`route_${r}`)}
              {r === "prototype" && <span className="text-[10px] font-semibold text-mutedtext">{t("routeDefault")}</span>}
            </span>
            <span className="block text-[12px] text-mutedtext">{t(`routeDesc_${r}`)}</span>
            <span className="block text-[11.5px] font-medium text-inventory">{t(`routeConsequence_${r}`)}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {route !== pick && (
          <PrimaryButton onClick={choose} disabled={saving}>
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {t("routeUse", { route: t(`route_${pick}`) })}
          </PrimaryButton>
        )}
        {route && route === pick && (
          builtFor && !stale ? (
            <SoftButton onClick={build} disabled={building}>
              {building ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {building ? t("electronicsBuilding") : t("electronicsRebuild")}
            </SoftButton>
          ) : (
            <PrimaryButton onClick={build} disabled={building}>
              {building ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Cpu className="h-3.5 w-3.5" />}
              {building ? t("electronicsBuilding") : stale ? t("electronicsRebuildFor", { route: t(`route_${route}`) }) : t("electronicsBuild")}
            </PrimaryButton>
          )
        )}
        {route === null && <span className="text-[11.5px] text-mutedtext">{t("routeNoListYet")}</span>}
      </div>
      {building && <p className="text-[11.5px] text-mutedtext">{t("electronicsBuildingNote")}</p>}

      {error && (
        <Warn blocking>
          {t(`electronicsErr_${error.code}`)}
          {error.problems?.length ? (
            <ul className="mt-1 list-disc ps-5 font-mono text-[10.5px] font-normal">
              {error.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : null}
        </Warn>
      )}
      {warning && <Warn blocking={false}>{t("electronicsCircuitFailed")}</Warn>}
    </Card>
  );
}

/** Logic-level crossings and assumptions our rules made, in words. */
export function LevelFlags({ flags, assumptions }: { flags: LevelFlag[]; assumptions: string[] }) {
  const t = useTranslations("Prototyping");
  if (!flags.length && !assumptions.length) return null;
  return (
    <ul className="space-y-1 rounded-xl bg-inventory-bg/60 p-3">
      {flags.map((f) => (
        <li key={f.net} className="flex items-start gap-2 text-[12px] font-medium text-inventory">
          <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {t(f.direction === "high_to_low" ? "level_highToLow" : "level_lowToHigh", {
            drivers: f.drivers.join(", "),
            receivers: f.receivers.join(", "),
            net: f.net,
          })}
        </li>
      ))}
      {assumptions.map((a) => (
        <li key={a} className="flex items-start gap-2 text-[11.5px] text-mutedtext">
          <CircleAlert className="mt-0.5 h-3 w-3 shrink-0" />
          {a}
        </li>
      ))}
    </ul>
  );
}
