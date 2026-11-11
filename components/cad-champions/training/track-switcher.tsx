"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { Spinner, useToast } from "@/components/cad-champions/ui";
import type { CcTrackSoftware } from "@/lib/cad-champions/db/types";
import { setTrackAction } from "@/lib/cad-champions/training/actions";

const TRACKS: CcTrackSoftware[] = ["inventor", "fusion", "solidworks"];

/** "Showing: Inventor - switch to Fusion / SOLIDWORKS". Saves cc_profiles.track_software, then reloads the lesson. */
export function TrackSwitcher({ current }: { current: CcTrackSoftware }) {
  const t = useTranslations("CC.training.player");
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = React.useTransition();

  function choose(track: CcTrackSoftware) {
    startTransition(async () => {
      const res = await setTrackAction(track);
      if (!res.ok) {
        toast.error(t("saveError"));
        return;
      }
      router.refresh();
    });
  }

  const others = TRACKS.filter((x) => x !== current);
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-body" aria-live="polite">
      <span className="font-semibold text-ink">{t("showing", { track: t(`tracks.${current}`) })}</span>
      <span aria-hidden="true">-</span>
      {others.map((track, i) => (
        <React.Fragment key={track}>
          {i > 0 ? <span aria-hidden="true">/</span> : null}
          <button
            type="button"
            disabled={pending}
            onClick={() => choose(track)}
            className="tap-target-y rounded-md px-1 font-semibold text-accent underline underline-offset-2 hover:text-cobalt-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
          >
            {t("switchTo", { track: t(`tracks.${track}`) })}
          </button>
        </React.Fragment>
      ))}
      {pending ? <Spinner size="sm" label={t("switching")} /> : null}
    </div>
  );
}
