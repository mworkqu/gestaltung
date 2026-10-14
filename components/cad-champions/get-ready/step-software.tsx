"use client";

import * as React from "react";
import { ExternalLink, GraduationCap, MessageCircle, Star } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button, StatusChip } from "@/components/cad-champions/ui";
import { VideoSlot } from "@/components/cad-champions/video/video-slot";
import type { CcTrackSoftware } from "@/lib/cad-champions/db/types";
import {
  AUTODESK_EDUCATION_URL,
  AUTODESK_FACTS,
  SOFTWARE_CONTENT,
  SOFTWARE_TABS,
  tabForTrack,
  type SoftwareTab,
} from "@/lib/cad-champions/get-ready/content";
import { cn } from "@/lib/utils";

import { HelpLink, StepsList, SubHeading } from "./shared";

export function StepSoftware({
  track,
  solidworksWhatsappUrl,
}: {
  track: CcTrackSoftware | null;
  solidworksWhatsappUrl: string | null;
}) {
  const t = useTranslations("CC.get-ready");
  const trackTab = tabForTrack(track);
  const [tab, setTab] = React.useState<SoftwareTab>(trackTab);
  const baseId = React.useId();
  const tabRefs = React.useRef<Record<string, HTMLButtonElement | null>>({});

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const i = SOFTWARE_TABS.indexOf(tab);
    const rtl = document.documentElement.dir === "rtl";
    let next: number | null = null;
    if (e.key === (rtl ? "ArrowLeft" : "ArrowRight")) next = (i + 1) % SOFTWARE_TABS.length;
    if (e.key === (rtl ? "ArrowRight" : "ArrowLeft")) next = (i - 1 + SOFTWARE_TABS.length) % SOFTWARE_TABS.length;
    if (e.key === "Home") next = 0;
    if (e.key === "End") next = SOFTWARE_TABS.length - 1;
    if (next === null) return;
    e.preventDefault();
    const key = SOFTWARE_TABS[next];
    setTab(key);
    tabRefs.current[key]?.focus();
  }

  const c = SOFTWARE_CONTENT[tab];

  return (
    <div className="space-y-5">
      <div
        role="tablist"
        aria-label={t("software.tabsLabel")}
        onKeyDown={onKeyDown}
        className="neu-inset flex gap-1 overflow-x-auto rounded-2xl p-1"
      >
        {SOFTWARE_TABS.map((key) => {
          const selected = key === tab;
          return (
            <button
              key={key}
              ref={(el) => {
                tabRefs.current[key] = el;
              }}
              id={`${baseId}-tab-${key}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`${baseId}-panel`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setTab(key)}
              className={cn(
                "inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-xl px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                selected ? "bg-surface text-ink shadow-neu-sm" : "text-body hover:text-ink"
              )}
            >
              {SOFTWARE_CONTENT[key].recommended ? <Star aria-hidden="true" strokeWidth={1.75} className="h-4 w-4 text-accent" /> : null}
              {t(`software.${key}.name`)}
            </button>
          );
        })}
      </div>

      <div id={`${baseId}-panel`} role="tabpanel" aria-labelledby={`${baseId}-tab-${tab}`} className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="text-lg font-extrabold text-heading">{t(`software.${tab}.name`)}</h4>
          {c.recommended ? <StatusChip tone="info" icon={Star}>{t("software.recommendedBadge")}</StatusChip> : null}
          {tab === trackTab && track ? <StatusChip tone="neutral">{t("software.yourTrack")}</StatusChip> : null}
        </div>

        <dl className="grid gap-4 sm:grid-cols-2">
          {(["suits", "platforms", "howToGet", "duration"] as const).map((k) => (
            <div key={k} className="tile">
              <dt className="text-xs font-semibold text-body">{t(`software.${k}Title`)}</dt>
              <dd className="mt-1 text-sm text-ink">{t(`software.${tab}.${k}`)}</dd>
            </div>
          ))}
        </dl>

        {c.autodesk ? (
          <div className="rounded-2xl border border-[#c3d6f3] bg-[#e3edfb] p-4">
            <div className="flex items-center gap-2">
              <GraduationCap aria-hidden="true" strokeWidth={1.75} className="h-5 w-5 text-[#0a3f8f]" />
              <p className="text-sm font-bold text-ink">{t("software.autodeskTitle")}</p>
            </div>
            <ul className="mt-2 list-disc space-y-1 ps-5 text-sm text-body">
              {AUTODESK_FACTS.map((f) => (
                <li key={f}>{t(`software.autodesk.${f}`)}</li>
              ))}
            </ul>
            <a
              href={AUTODESK_EDUCATION_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex min-h-[44px] items-center gap-1.5 text-sm font-semibold text-accent underline-offset-2 hover:underline"
            >
              {t("software.autodeskLink")}
              <ExternalLink aria-hidden="true" strokeWidth={1.75} className="h-4 w-4 rtl:-scale-x-100" />
            </a>
          </div>
        ) : null}

        {tab === "solidworks" ? (
          <div className="tile space-y-2">
            <p className="text-sm text-ink">
              {t("software.solidworksContact")} <span className="text-body">{t("software.solidworksOffer")}</span>
            </p>
            {solidworksWhatsappUrl ? (
              <Button asChild variant="secondary" size="sm">
                <a href={solidworksWhatsappUrl} target="_blank" rel="noopener noreferrer">
                  <MessageCircle aria-hidden="true" strokeWidth={1.75} className="h-4 w-4" />
                  {t("computer.noComputerCta")}
                </a>
              </Button>
            ) : (
              <p className="text-sm text-body">{t("computer.noComputerNoWhatsapp")}</p>
            )}
          </div>
        ) : null}

        <div className="space-y-2">
          <SubHeading>{t("software.installTitle")}</SubHeading>
          <StepsList items={c.installSteps.map((s) => t(`software.${tab}.install.${s}`))} />
        </div>

        {c.videoKey ? <VideoSlot videoKey={c.videoKey} className="max-w-xl" /> : null}

        <div className="space-y-2">
          <SubHeading>{t("software.troubleTitle")}</SubHeading>
          <ul className="list-disc space-y-1 ps-5 text-sm text-body">
            {c.troubleshooting.map((s) => (
              <li key={s}>{t(`software.${tab}.trouble.${s}`)}</li>
            ))}
          </ul>
        </div>

        <p className="text-sm font-semibold text-ink">{t("software.schoolNote")}</p>
        <HelpLink slug={c.helpSlug}>{t("list.helpLink")}</HelpLink>
      </div>
    </div>
  );
}
