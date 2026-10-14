"use client";

import * as React from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { useTranslations } from "next-intl";

import { submitHelpFeedback } from "@/app/[locale]/cad-champions/help/[slug]/actions";
import { Button } from "@/components/cad-champions/ui";

// "Was this helpful?" - one vote per browser per article (localStorage flag).

type State = "idle" | "sending" | "yes" | "no";

const key = (slug: string) => `cc_help_vote_${slug}`;

function readVote(slug: string): "yes" | "no" | null {
  try {
    const v = window.localStorage.getItem(key(slug));
    return v === "yes" || v === "no" ? v : null;
  } catch {
    return null;
  }
}

export function HelpfulVote({ slug }: { slug: string }) {
  const t = useTranslations("CC.help");
  const [state, setState] = React.useState<State>("idle");
  const [error, setError] = React.useState<"save" | "rate" | null>(null);

  React.useEffect(() => {
    const prior = readVote(slug);
    if (prior) setState(prior);
  }, [slug]);

  async function vote(helpful: boolean) {
    setError(null);
    setState("sending");
    const res = await submitHelpFeedback(slug, helpful);
    if (!res.ok) {
      setState("idle");
      setError(res.error === "rate" ? "rate" : "save");
      return;
    }
    try {
      window.localStorage.setItem(key(slug), helpful ? "yes" : "no");
    } catch {
      // Private mode: the vote still counted; the flag just will not persist.
    }
    setState(helpful ? "yes" : "no");
  }

  if (state === "yes" || state === "no") {
    return (
      <p role="status" className="text-sm font-semibold text-ink">
        {state === "yes" ? t("helpfulThanks") : t("helpfulThanksNo")}
      </p>
    );
  }

  const sending = state === "sending";
  return (
    <div className="space-y-3">
      <p className="text-sm font-bold text-ink">{t("helpfulQuestion")}</p>
      <div className="flex flex-wrap gap-3">
        <Button variant="secondary" size="sm" loading={sending} loadingText={t("helpfulSending")} onClick={() => vote(true)}>
          <ThumbsUp aria-hidden="true" strokeWidth={1.75} className="h-4 w-4" />
          {t("helpfulYes")}
        </Button>
        <Button variant="secondary" size="sm" disabled={sending} onClick={() => vote(false)}>
          <ThumbsDown aria-hidden="true" strokeWidth={1.75} className="h-4 w-4" />
          {t("helpfulNo")}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-[#a1231f]">
          {error === "rate" ? t("helpfulRate") : t("helpfulError")}
        </p>
      ) : null}
    </div>
  );
}
