"use client";

import * as React from "react";
import { Check } from "lucide-react";
import { useTranslations } from "next-intl";

import { Alert, StatusChip } from "@/components/cad-champions/ui";
import { CC_TRACKS, type CcTrack } from "@/lib/cad-champions/profile/track";
import { cn } from "@/lib/utils";

const NAME_KEY: Record<CcTrack, "inventorName" | "fusionName" | "solidworksName"> = {
  inventor: "inventorName",
  fusion: "fusionName",
  solidworks: "solidworksName",
};
const SUITS_KEY: Record<CcTrack, "inventorSuits" | "fusionSuits" | "solidworksSuits"> = {
  inventor: "inventorSuits",
  fusion: "fusionSuits",
  solidworks: "solidworksSuits",
};

/**
 * Three large radio cards (Inventor, Fusion, SOLIDWORKS) in competition-priority order.
 * Shared by onboarding and account settings. Strings come from CC.onboarding.software.
 */
export function TrackPicker({
  value,
  onChange,
  name = "track",
  disabled = false,
}: {
  value: CcTrack;
  onChange: (next: CcTrack) => void;
  name?: string;
  disabled?: boolean;
}) {
  const t = useTranslations("CC.onboarding.software");
  return (
    <div className="space-y-4">
      <div role="radiogroup" aria-label={t("groupLabel")} className="grid gap-4 md:grid-cols-3">
        {CC_TRACKS.map((track) => {
          const selected = value === track;
          return (
            <label
              key={track}
              className={cn(
                "neu relative flex min-h-[44px] cursor-pointer flex-col gap-3 p-5 text-start transition-shadow",
                "focus-within:ring-2 focus-within:ring-accent focus-within:ring-offset-2 focus-within:ring-offset-surface",
                selected && "border-accent ring-1 ring-accent",
                disabled && "cursor-not-allowed opacity-60",
              )}
            >
              <input
                type="radio"
                name={name}
                value={track}
                checked={selected}
                disabled={disabled}
                onChange={() => onChange(track)}
                className="peer sr-only"
              />
              <span className="flex items-start justify-between gap-2">
                <span className="text-lg font-extrabold text-heading">{t(NAME_KEY[track])}</span>
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border",
                    selected ? "border-accent bg-accent text-accent-foreground" : "border-border bg-surface text-transparent",
                  )}
                >
                  <Check strokeWidth={2.5} className="h-4 w-4" />
                </span>
              </span>
              {track === "inventor" ? (
                <span>
                  <StatusChip tone="info">{t("recommended")}</StatusChip>
                </span>
              ) : null}
              <span className="text-sm text-body">{t(SUITS_KEY[track])}</span>
              {selected ? <span className="sr-only">{t("selected")}</span> : null}
            </label>
          );
        })}
      </div>
      {value === "solidworks" ? (
        <Alert tone="warning" title={t("solidworksNoteTitle")}>
          {t("solidworksNote")}
        </Alert>
      ) : null}
    </div>
  );
}
