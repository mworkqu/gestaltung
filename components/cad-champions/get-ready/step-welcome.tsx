"use client";

import * as React from "react";
import { CheckCircle2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/cad-champions/ui";
import { useVideoSlot } from "@/components/cad-champions/video/use-video-slot";
import { VideoSlot } from "@/components/cad-champions/video/video-slot";
import { WELCOME_TAKEAWAYS, WELCOME_VIDEO } from "@/lib/cad-champions/get-ready/content";

import { SubHeading } from "./shared";

export function StepWelcome({ done, saving, onDone }: { done: boolean; saving: boolean; onDone: () => void }) {
  const t = useTranslations("CC.get-ready");
  const realPlayer = useVideoSlot(WELCOME_VIDEO).realPlayer;
  const onWatched = React.useCallback(() => {
    if (!done) onDone();
  }, [done, onDone]);

  return (
    <div className="space-y-5">
      <VideoSlot videoKey={WELCOME_VIDEO} onWatched={realPlayer ? onWatched : undefined} />
      <p className="text-sm text-body">{realPlayer ? t("welcome.autoNote") : t("welcome.placeholderNote")}</p>

      <div className="space-y-2">
        <SubHeading>{t("welcome.takeawaysTitle")}</SubHeading>
        <ul className="space-y-2">
          {WELCOME_TAKEAWAYS.map((k) => (
            <li key={k} className="flex items-start gap-2 text-sm text-body">
              <CheckCircle2 aria-hidden="true" strokeWidth={1.75} className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
              <span>{t(`welcome.takeaways.${k}`)}</span>
            </li>
          ))}
        </ul>
      </div>

      {!realPlayer && !done ? (
        <Button type="button" onClick={onDone} loading={saving} loadingText={t("list.saving")}>
          {t("welcome.markWatched")}
        </Button>
      ) : null}
    </div>
  );
}
