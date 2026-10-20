"use client";

// "Our understanding" (2026-10-18): the agent's full understanding of the idea,
// above the chat so the visitor can confirm it — goal, how it works, and the
// parts (controller, sensors, servos / small linear actuators, outputs) with
// counts and the build tier (Explorers / Makers / Engineers, lib/studio/tiers.ts).
// The agent rebuilds it in full on every chat turn (lib/studio/ai/prompts.ts).

import { useTranslations } from "next-intl";
import { ChevronDown, Cpu, Gauge, Lightbulb, Move } from "lucide-react";

import { BUILD_CLASSES, type BuildClass, type ProductSpec, Understanding, UnderstandingMover, UnderstandingPart } from "@/lib/studio/schema";
import { classFor } from "@/lib/studio/build-class";
import { countParts, tierOf } from "@/lib/studio/tiers";
import { isLight } from "@/lib/studio/card-parts";
import { arabicCountForm } from "@/lib/text/count";
import { STEP_ACCENT } from "@/lib/studio/palette";
import { cn } from "@/lib/utils";
import { Bar } from "../ui";

const accent = STEP_ACCENT.idea;

export function UnderstandingPanel({
  spec,
  busy,
  open,
  onToggle,
  onBuildClass,
}: {
  /** The confirmed card (null while the first questions are asked). */
  spec: ProductSpec | null;
  busy: boolean;
  open: boolean;
  onToggle: () => void;
  /**
   * The visitor overrules the build shape. The parent saves it exactly like any other card edit:
   * setSpec({ ...spec, buildClass }) (IdeaStep) -> onDraft -> StudioShell.docForCard -> commit.
   * Omitted = the control is not shown (read-only card).
   */
  onBuildClass?: (buildClass: BuildClass) => void;
}) {
  const t = useTranslations("Studio");
  const u = spec?.understanding;
  const tier = tierOf(spec);
  const count = spec ? countParts(spec) : null;
  const bodyId = "studio-understanding-body";

  return (
    <section
      aria-label={t("understanding.title")}
      aria-busy={busy}
      className="neu space-y-4 p-5 sm:p-6"
      data-testid="studio-understanding"
      data-tier={tier.id}
      data-state={u ? "ready" : spec ? "old" : "empty"}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={bodyId}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-start lg:pointer-events-none"
        >
          <span className="min-w-0">
            <span className="block font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-azure rtl:font-sans rtl:tracking-normal">
              {t("understanding.title")}
            </span>
            {spec && (
              <span className="mt-1 block text-lg font-extrabold leading-tight tracking-tight text-heading" dir="auto">
                {spec.name}
              </span>
            )}
          </span>
          <ChevronDown
            aria-hidden
            className={cn("ms-auto h-5 w-5 shrink-0 text-mutedtext transition-transform lg:hidden", open && "rotate-180")}
            strokeWidth={1.75}
          />
        </button>
        {spec && (
          <span
            className="inline-flex items-center gap-1.5 rounded-full bg-panel px-3 py-1.5 text-xs font-bold text-heading shadow-neu-sm"
            title={t(`tiers.${tier.id}_blurb`, { m: String(tier.multiplier) })}
            data-testid="studio-tier-badge"
          >
            <Gauge className="h-3.5 w-3.5" style={{ color: accent.ink }} strokeWidth={2} aria-hidden />
            {t("tiers.level", { tier: t(`tiers.${tier.id}`) })}
            {tier.multiplier > 1 && <span className="font-mono text-mutedtext">×{tier.multiplier}</span>}
          </span>
        )}
      </div>

      <div id={bodyId} className={cn("space-y-4", !open && "max-lg:hidden")}>
        {!u ? (
          <p className="rounded-xl bg-panel/70 px-4 py-3 text-sm text-mutedtext shadow-neu-inset">
            {busy ? t("understanding.learning") : spec ? t("understanding.old") : t("understanding.empty")}
          </p>
        ) : (
          <>
            <div className={cn("grid gap-4 sm:grid-cols-2 transition-opacity", busy && "opacity-60")}>
              <Field label={t("understanding.goal")} text={u.goal} />
              <Field label={t("understanding.how")} text={u.howItWorks} />
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-bold text-heading">{t("understanding.parts")}</h3>
                {count && (
                  <p className="font-mono text-[11px] tabular-nums text-mutedtext rtl:font-sans" data-testid="studio-part-count">
                    {tally(u).map(([key, n]) => t(`understanding.cnt_${key}`, { count: String(n), form: arabicCountForm(n) })).join(" · ")}
                  </p>
                )}
              </div>
              <div className={cn("grid gap-3 sm:grid-cols-2 transition-opacity", busy && "opacity-60")}>
                <Group icon={Cpu} title={t("understanding.controller")}>
                  {u.controller ? <PartLine name={u.controller} count={1} /> : <None />}
                </Group>
                <Group icon={Gauge} title={t("understanding.sensors")}>
                  {u.sensors.length ? u.sensors.map((p, i) => <PartLine key={i} {...p} />) : <None />}
                </Group>
                <Group icon={Move} title={t("understanding.actuators")}>
                  {u.actuators.length ? u.actuators.map((p, i) => <MoverLine key={i} part={p} />) : <None />}
                </Group>
                <Group icon={Lightbulb} title={t("understanding.outputs")}>
                  {u.outputs.length ? u.outputs.map((p, i) => <PartLine key={i} {...p} />) : <None />}
                </Group>
              </div>
            </div>
            {spec && onBuildClass && <BuildClassPicker value={classFor(spec)} disabled={busy} onChange={onBuildClass} />}
            <p className="text-xs leading-relaxed text-mutedtext">{t("understanding.note")}</p>
          </>
        )}
        {busy && !u && <Bar className="h-3 w-40" />}
      </div>
    </section>
  );
}

/** "1 controller · 1 sensor · 1 pump · 3 lights": every kind of part on the card, zeros left out. */
function tally(u: Understanding): [string, number][] {
  const out = new Map<string, number>();
  const add = (k: string, n: number) => n > 0 && out.set(k, (out.get(k) ?? 0) + n);
  add("controller", u.controller ? 1 : 0);
  add("sensor", u.sensors.reduce((s, x) => s + x.count, 0));
  for (const a of u.actuators) add(a.kind, a.count);
  for (const o of u.outputs) add(isLight(o.name) ? "light" : "output", o.count);
  return [...out.entries()];
}

/** What kind of build this is, in words a non-engineer reads (never "mcu / logic / cad"). */
function BuildClassPicker({
  value,
  disabled,
  onChange,
}: {
  value: BuildClass;
  disabled: boolean;
  onChange: (c: BuildClass) => void;
}) {
  const t = useTranslations("Studio");
  return (
    <fieldset className="space-y-2" disabled={disabled} data-testid="studio-build-class">
      <legend className="text-xs font-semibold text-mutedtext">{t("understanding.buildClass")}</legend>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("understanding.buildClass")}>
        {BUILD_CLASSES.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={value === c}
            onClick={() => value !== c && onChange(c)}
            className={cn(
              "min-h-11 rounded-xl px-3.5 text-sm font-semibold transition-colors disabled:opacity-60",
              value === c ? "bg-panel text-heading shadow-neu-inset" : "bg-panel text-mutedtext shadow-neu-sm hover:text-heading",
            )}
          >
            {t(`understanding.buildClass_${c}`)}
          </button>
        ))}
      </div>
      <p className="text-xs leading-relaxed text-mutedtext">{t("understanding.buildClassNote")}</p>
    </fieldset>
  );
}

function Field({ label, text }: { label: string; text: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold text-mutedtext">{label}</p>
      <p className="text-sm leading-relaxed text-heading" dir="auto">
        {text || "—"}
      </p>
    </div>
  );
}

function Group({ icon: Icon, title, children }: { icon: typeof Cpu; title: string; children: React.ReactNode }) {
  return (
    <div className="tile space-y-1.5 p-3">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint rtl:tracking-normal">
        <Icon className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
        {title}
      </p>
      <ul className="space-y-1">{children}</ul>
    </div>
  );
}

function PartLine({ name, count, purpose, kind }: UnderstandingPart & { kind?: string }) {
  return (
    <li className="text-sm leading-snug">
      <span className="font-semibold text-heading" dir="auto">
        {name}
      </span>
      {count > 1 && <span className="ms-1 font-mono text-xs font-bold tabular-nums" style={{ color: accent.ink }}>×{count}</span>}
      {kind && <span className="ms-1.5 text-[11px] text-faint">({kind})</span>}
      {purpose && (
        <span className="block text-xs text-mutedtext" dir="auto">
          {purpose}
        </span>
      )}
    </li>
  );
}

function MoverLine({ part }: { part: UnderstandingMover }) {
  const t = useTranslations("Studio");
  return <PartLine {...part} kind={t(`understanding.kind_${part.kind}`)} />;
}

function None() {
  const t = useTranslations("Studio");
  return <li className="text-sm text-faint">{t("understanding.none")}</li>;
}
