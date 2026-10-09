"use client";

// Electronics in three plain steps (owner, 2026-09-29: "can I just say board
// custom or prototype, then power 1, 2, 3, then generate the component list"):
//
//   1 Board       — Prototype (dev boards and modules, parts available now) or
//                   Custom PCB (a designed board, slower and costlier).
//   2 Power       — 1 plug-in adapter · 2 battery · 3 solar + battery.
//   3 Components  — one button builds the list (and the circuit) from 1 + 2.
//
// Each choice saves on click. The analysis may recommend a board; it is shown
// as advice, never chosen for the client.

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ArrowRight, BatteryFull, Check, CircleAlert, Cpu, Lightbulb, Loader2, Plug, RefreshCw, Sun } from "lucide-react";

import { AccessNote } from "@/components/credits/access-note";
import { Card, PrimaryButton, SoftButton, Warn } from "@/components/prototyping/ui";
import type { BuildRoute, RouteRecommendation } from "@/lib/prototyping/analysis";
import type { LevelFlag } from "@/lib/prototyping/electronics-rules";
import { cn } from "@/lib/utils";
import { track } from "@/lib/analytics";
import { creditsChanged } from "@/lib/credits/use-credits";

const optionClass = (on: boolean) =>
  cn(
    "relative flex flex-col gap-1 rounded-2xl p-4 text-start transition-shadow",
    on ? "bg-surface shadow-neu-inset ring-2 ring-cobalt/60" : "bg-panel shadow-neu-sm hover:ring-1 hover:ring-cobalt/30"
  );

function Picked() {
  return (
    <span className="absolute end-3 top-3 grid h-5 w-5 place-items-center rounded-full bg-cobalt text-white">
      <Check className="h-3 w-3" />
    </span>
  );
}

function Next({ label, onClick }: { label: string; onClick: () => void }) {
  const locale = useLocale();
  return (
    <PrimaryButton onClick={onClick}>
      {label}
      <ArrowRight className={cn("h-3.5 w-3.5", locale === "ar" && "rotate-180")} />
    </PrimaryButton>
  );
}

/** Step 1 — Prototype or Custom PCB. Saves on click. */
export function BoardChoice({
  route,
  recommendation,
  onRoute,
  onNext,
}: {
  route: BuildRoute | null;
  recommendation: RouteRecommendation | null;
  onRoute: (r: BuildRoute) => Promise<boolean>;
  onNext: () => void;
}) {
  const t = useTranslations("Prototyping");
  const [saving, setSaving] = useState<BuildRoute | null>(null);
  const [failed, setFailed] = useState(false);

  async function pick(r: BuildRoute) {
    if (r === route) return;
    setSaving(r);
    setFailed(!(await onRoute(r)));
    setSaving(null);
  }

  return (
    <div id="board-choice" tabIndex={-1} className="outline-none">
      <Card kicker={t("elecStep", { n: 1 })} title={t("boardTitle")} intro={t("boardIntro")}>
        {recommendation && (
          <p className="flex items-start gap-2 rounded-xl bg-panel/60 px-3 py-2 text-[12px] text-heading">
            <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cobalt" />
            <span>
              <span className="font-semibold">{t("routeRecommendation", { route: t(`route_${recommendation.recommended}`) })}</span>{" "}
              {recommendation.reason}
            </span>
          </p>
        )}
        <div role="radiogroup" aria-label={t("boardTitle")} className="grid gap-3 sm:grid-cols-2">
          {(["prototype", "custom_pcb"] as const).map((r) => (
            <button key={r} type="button" role="radio" aria-checked={route === r} onClick={() => pick(r)} className={optionClass(route === r)}>
              {route === r && <Picked />}
              <span className="flex items-center gap-2 text-sm font-bold text-heading">
                {saving === r && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {t(`route_${r}`)}
              </span>
              <span className="text-[12px] text-mutedtext">{t(`routeDesc_${r}`)}</span>
              <span className="text-[11.5px] font-medium text-inventory">{t(`routeConsequence_${r}`)}</span>
            </button>
          ))}
        </div>
        {failed && <Warn blocking>{t("electronicsErr_not_ready")}</Warn>}
        {route && (
          <div>
            <Next label={t("elecNextPower")} onClick={onNext} />
          </div>
        )}
      </Card>
    </div>
  );
}

export const POWER_OPTIONS = [
  { value: "mains", icon: Plug },
  { value: "battery", icon: BatteryFull },
  { value: "solar", icon: Sun },
] as const;

/** Step 2 — how it's powered: 1, 2 or 3. Saves on click. */
export function PowerChoice({
  value,
  onPick,
  onNext,
}: {
  value: string | null;
  onPick: (v: string) => void;
  onNext: () => void;
}) {
  const t = useTranslations("Prototyping");
  return (
    <div id="power-choice" tabIndex={-1} className="outline-none">
      <Card kicker={t("elecStep", { n: 2 })} title={t("powerTitle")} intro={t("powerPickIntro")}>
        <div role="radiogroup" aria-label={t("powerTitle")} className="grid gap-3 sm:grid-cols-3">
          {POWER_OPTIONS.map(({ value: v, icon: Icon }, i) => (
            <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onPick(v)} className={optionClass(value === v)}>
              {value === v && <Picked />}
              <span className="flex items-center gap-2 text-sm font-bold text-heading">
                <span className="grid h-6 w-6 place-items-center rounded-full bg-panel text-[11px] font-bold text-cobalt shadow-neu-sm">{i + 1}</span>
                <Icon className="h-4 w-4 text-cobalt" />
                {t(`powerOpt_${v}`)}
              </span>
              <span className="text-[12px] text-mutedtext">{t(`powerOptDesc_${v}`)}</span>
            </button>
          ))}
        </div>
        {value && (
          <div>
            <Next label={t("elecNextComponents")} onClick={onNext} />
          </div>
        )}
      </Card>
    </div>
  );
}

type BuildError = { code: string; problems?: string[] };

/** Step 3 — one button builds the component list (and the circuit). */
export function GenerateComponents({
  projectId,
  projectName,
  route,
  power,
  builtFor,
  onBuilt,
  onGoBoard,
  onGoPower,
}: {
  projectId: string;
  /** For the "buy credits" WhatsApp message when the circuit was skipped. */
  projectName?: string | null;
  route: BuildRoute | null;
  power: string | null;
  /** The board the current list was built for, if any. */
  builtFor: BuildRoute | null;
  onBuilt: () => Promise<void>;
  onGoBoard: () => void;
  onGoPower: () => void;
}) {
  const t = useTranslations("Prototyping");
  const tc = useTranslations("Credits");
  const locale = useLocale();
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<BuildError | null>(null);
  const [warning, setWarning] = useState(false);
  // Why the circuit was not redrawn with this list (no wiring access/credit).
  const [skipped, setSkipped] = useState<string | null>(null);

  async function build() {
    setBuilding(true);
    setError(null);
    setWarning(false);
    setSkipped(null);
    try {
      const res = await fetch("/api/bom/electronics", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId, locale }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        problems?: string[];
        circuit?: string;
        circuitReason?: string | null;
      };
      if (!res.ok) setError({ code: data.error ?? "failed", problems: data.problems });
      else {
        if (data.circuit === "failed") setWarning(true);
        if (data.circuit === "skipped") setSkipped(data.circuitReason ?? "no_credits");
        if (data.circuit === "ok") track("circuit_generated", { cost: "credit" });
        else if (data.circuit === "skipped") track("circuit_generated", { cost: "blocked" });
        await onBuilt();
      }
      creditsChanged();
    } catch {
      setError({ code: "failed" });
    }
    setBuilding(false);
  }

  const stale = !!route && !!builtFor && builtFor !== route;
  const ready = !!route && !!power;
  const done = (label: string, value: string | null, go: () => void) => (
    <button
      type="button"
      onClick={go}
      className={cn(
        "flex items-center gap-2 rounded-xl px-3 py-2 text-[12.5px] font-medium shadow-neu-sm",
        value ? "bg-buy-bg text-buy" : "bg-inventory-bg text-inventory"
      )}
    >
      {value ? <Check className="h-3.5 w-3.5" /> : <CircleAlert className="h-3.5 w-3.5" />}
      {label}: {value ?? t("elecNotChosen")}
    </button>
  );

  return (
    <div id="route-card" tabIndex={-1} className="outline-none">
      <Card kicker={t("elecStep", { n: 3 })} title={t("componentsGenTitle")} intro={t("componentsGenIntro")}>
        {/* P1-05: where the wiring comes from, in one muted line. */}
        <p className="max-w-[62ch] text-[11.5px] leading-relaxed text-mutedtext">{t("datasheetLine")}</p>
        <div className="flex flex-wrap gap-2">
          {done(t("boardTitle"), route ? t(`route_${route}`) : null, onGoBoard)}
          {done(t("powerTitle"), power ? t(`powerOpt_${power}`) : null, onGoPower)}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {builtFor && !stale ? (
            <SoftButton onClick={build} disabled={building || !ready}>
              {building ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {building ? t("electronicsBuilding") : t("electronicsRebuild")}
            </SoftButton>
          ) : (
            <PrimaryButton onClick={build} disabled={building || !ready}>
              {building ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Cpu className="h-3.5 w-3.5" />}
              {building ? t("electronicsBuilding") : t("componentsGenerate")}
            </PrimaryButton>
          )}
          {!ready && <span className="text-[11.5px] text-mutedtext">{t("componentsNeedChoices")}</span>}
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
        {skipped && <Warn blocking={false}>{tc(skipped === "sign_in" ? "listOnlySignIn" : "listOnlyNoCredits")}</Warn>}
        {/* The parts list is free; the circuit needs a credit — show how to get one. */}
        {skipped === "no_credits" && <AccessNote reason="no_credits" step="wiring" projectName={projectName} />}
      </Card>
    </div>
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
