"use client";

import * as React from "react";
import { AlertTriangle, Smartphone } from "lucide-react";
import { useTranslations } from "next-intl";

import { HelpTip, Term } from "@/components/cad-champions/ui";
import { VideoSlot } from "@/components/cad-champions/video/video-slot";
import type { CcTrackSoftware } from "@/lib/cad-champions/db/types";
import {
  ACTION_SOFTWARE,
  ESSENTIAL_ACTIONS,
  EXPORT_STEP_HELP,
  actionSoftwareFor,
  type ActionSoftware,
} from "@/lib/cad-champions/get-ready/content";
import type { GlossaryId } from "@/lib/cad-champions/glossary";
import { ESSENTIAL_ACTION_KEYS, type EssentialActionKey } from "@/lib/cad-champions/get-ready/steps";
import { cn } from "@/lib/utils";

import { CheckRow, HelpLink, StepsList, SubHeading } from "./shared";

const ACTION_TERM: Partial<Record<EssentialActionKey, GlossaryId>> = {
  units_mm: "units-mm",
  material_density: "material-density",
  export_step: "step-file",
};

export function StepActions({
  track,
  ticked,
  disabled,
  onTick,
}: {
  track: CcTrackSoftware | null;
  ticked: Set<string>;
  disabled: boolean;
  onTick: (sub: EssentialActionKey, checked: boolean) => void;
}) {
  const t = useTranslations("CC.get-ready");
  const [software, setSoftware] = React.useState<ActionSoftware>(actionSoftwareFor(track));
  const baseId = React.useId();

  return (
    <div className="space-y-5">
      <p className="text-sm text-body">{t("actions.intro")}</p>
      <p className="text-sm font-semibold text-ink" aria-live="polite">
        {t("actions.progress", { done: String(ticked.size), total: String(ESSENTIAL_ACTION_KEYS.length) })}
      </p>

      <fieldset className="space-y-2">
        <legend className="text-xs font-semibold text-body">{t("actions.softwareLabel")}</legend>
        <div className="neu-inset inline-flex flex-wrap gap-1 rounded-2xl p-1">
          {ACTION_SOFTWARE.map((sw) => (
            <label
              key={sw}
              className={cn(
                "inline-flex min-h-[44px] cursor-pointer items-center rounded-xl px-4 text-sm font-semibold transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent",
                software === sw ? "bg-surface text-ink shadow-neu-sm" : "text-body hover:text-ink"
              )}
            >
              <input
                type="radio"
                name={`${baseId}-software`}
                value={sw}
                checked={software === sw}
                onChange={() => setSoftware(sw)}
                className="sr-only"
              />
              {t(`actions.software.${sw}`)}
            </label>
          ))}
        </div>
      </fieldset>

      <ol className="space-y-4">
        {ESSENTIAL_ACTION_KEYS.map((key, index) => {
          const c = ESSENTIAL_ACTIONS[key];
          const term = ACTION_TERM[key];
          const isTicked = ticked.has(key);
          return (
            <li key={key} className={cn("tile space-y-4", isTicked && "border-buy/30")}>
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="text-base font-extrabold text-heading">
                  <span className="text-body">{index + 1}. </span>
                  {t(`actions.items.${key}.title`)}
                </h4>
                {key === "material_density" ? (
                  <HelpTip label={t(`actions.items.${key}.title`)}>{t("actions.densityHelp")}</HelpTip>
                ) : null}
              </div>

              <div className="space-y-1">
                <SubHeading>{t("actions.whyTitle")}</SubHeading>
                <p className="text-sm text-body">
                  {t(`actions.items.${key}.why`)}
                  {term ? (
                    <>
                      {" "}
                      <Term id={term} />
                    </>
                  ) : null}
                </p>
              </div>

              <div className="space-y-1">
                <SubHeading>{t(`actions.software.${software}`)}</SubHeading>
                <StepsList items={c.steps[software].map((s) => t(`actions.items.${key}.steps.${software}.${s}`))} />
              </div>

              <div className="flex items-start gap-3 rounded-xl border border-inventory/20 bg-inventory-bg p-3">
                <AlertTriangle aria-hidden="true" strokeWidth={1.75} className="mt-0.5 h-4 w-4 shrink-0 text-inventory" />
                <div>
                  <p className="text-xs font-bold text-ink">{t("actions.mistakeTitle")}</p>
                  <p className="mt-0.5 text-sm text-body">{t(`actions.items.${key}.mistake`)}</p>
                </div>
              </div>

              {key === "find_upload" ? (
                <div className="flex items-start gap-3 text-sm text-body">
                  <Smartphone aria-hidden="true" strokeWidth={1.75} className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                  <p>{t("actions.phoneTip")}</p>
                </div>
              ) : null}

              <VideoSlot videoKey={c.videoKey} className="max-w-md" />

              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <CheckRow
                  id={`${baseId}-${key}`}
                  checked={isTicked}
                  disabled={disabled}
                  onChange={(checked) => onTick(key, checked)}
                  className="font-semibold"
                >
                  {t("actions.tickLabel")}
                </CheckRow>
                <HelpLink slug={key === "export_step" ? EXPORT_STEP_HELP[software] : c.helpSlug}>{t("list.helpLink")}</HelpLink>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
