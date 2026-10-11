"use client";

// "We couldn't move your guest project to your account. Try again" (W1).
// Rendered once in the locale layout (site chrome, BASE messages). It shows
// only when lib/auth/claim-guest-client.ts kept a failed claim for this tab:
// read from sessionStorage on mount and on its window event (the sign-in form
// navigates on the client, so the layout does not remount). Tiny on purpose:
// no Supabase, no extra request until "Try again" is pressed.

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, X } from "lucide-react";

import {
  CLAIM_EVENT,
  dismissPendingClaim,
  pendingClaimToken,
  retryPendingClaim,
} from "@/lib/auth/claim-guest-client";

type View = "hidden" | "shown" | "retrying" | "failed";

export function GuestClaimNotice() {
  const t = useTranslations("GuestClaim");
  const [view, setView] = useState<View>("hidden");

  useEffect(() => {
    const sync = () => setView((v) => (pendingClaimToken() ? (v === "hidden" ? "shown" : v) : "hidden"));
    sync();
    window.addEventListener(CLAIM_EVENT, sync);
    return () => {
      window.removeEventListener(CLAIM_EVENT, sync);
    };
  }, []);

  if (view === "hidden") return null;

  async function retry() {
    setView("retrying");
    const ok = await retryPendingClaim();
    if (ok) {
      // Show the page again as the account that now owns the work.
      window.location.reload();
      return;
    }
    setView("failed");
  }

  return (
    <div
      role="alert"
      data-testid="guest-claim-notice"
      className="fixed inset-x-4 top-4 z-50 mx-auto max-w-md print:hidden"
    >
      <div className="neu flex items-start gap-3 p-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-heading">{t("title")}</p>
          <p className="mt-1 text-sm text-body">{view === "failed" ? t("stillFailing") : t("text")}</p>
          <button
            type="button"
            onClick={() => void retry()}
            disabled={view === "retrying"}
            className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-full bg-cobalt px-5 text-sm font-semibold text-white transition-colors hover:bg-cobalt-hover disabled:opacity-70"
          >
            {view === "retrying" && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />}
            {view === "retrying" ? t("retrying") : t("tryAgain")}
          </button>
        </div>
        <button
          type="button"
          onClick={dismissPendingClaim}
          aria-label={t("dismiss")}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-mutedtext transition-colors hover:bg-panel hover:text-heading"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
