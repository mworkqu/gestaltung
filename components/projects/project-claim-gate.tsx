"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";

import { useRouter } from "@/i18n/navigation";
import { ensureSession } from "@/lib/supabase/guest";
import { recoveryKeyFromHash } from "@/lib/projects/recovery";
import { ProjectWorkspace } from "@/components/projects/project-workspace";

// D6 (0045): a project link from the email carries a secret key in the URL
// fragment (#key=…). Before the workspace loads, make sure this browser has a
// session (a guest gets an anonymous one — they asked to open their project),
// hand the key to /api/projects/claim, then drop it from the address bar. With
// no key this renders the workspace straight away, exactly as before.
//
// Turnstile (P2-08): the gate has no form for an inline widget, so when the
// switch is on ensureSession() asks the page's <TurnstileChallenge> dialog
// (app/[locale]/projects/[id]/page.tsx) for a token. Closing the dialog fails
// the claim ("claimError", the workspace still opens); with the switch off
// there is no dialog and the call is exactly the old one.

type Notice = "claimMoved" | "claimMovedEmailed" | "claimInvalid" | "claimHasAccount" | "claimLimit" | "claimError";

const REASON_NOTICE: Record<string, Notice> = {
  invalid: "claimInvalid",
  has_account: "claimHasAccount",
  project_limit: "claimLimit",
};

export function ProjectClaimGate({ projectId }: { projectId: string }) {
  const t = useTranslations("Projects");
  const locale = useLocale();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  // Once per page: a second claim with the same (now rotated) key would fail.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const key = recoveryKeyFromHash(window.location.hash);
    if (!key) {
      setReady(true);
      return;
    }
    setClaiming(true);
    void (async () => {
      let next: Notice | null = null;
      try {
        await ensureSession();
        const res = await fetch("/api/projects/claim", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId, key, locale }),
        });
        const json = (await res.json().catch(() => ({}))) as { ok?: boolean; status?: string; reason?: string; emailed?: boolean };
        if (json.ok) {
          if (json.status === "claimed") next = json.emailed ? "claimMovedEmailed" : "claimMoved";
        } else {
          next = REASON_NOTICE[json.reason ?? ""] ?? "claimError";
        }
      } catch {
        next = "claimError";
      }
      // The key never stays in the address bar or history.
      window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
      setNotice(next);
      setReady(true);
      router.refresh();
    })();
  }, [projectId, locale, router]);

  if (!ready) {
    return (
      <div className="neu flex items-center justify-center gap-3 p-16 text-sm text-mutedtext">
        <Loader2 className="h-5 w-5 animate-spin" />
        {claiming && t("claimOpening")}
      </div>
    );
  }

  const good = notice === "claimMoved" || notice === "claimMovedEmailed";
  return (
    <div className="space-y-4">
      {notice && (
        <p
          role={good ? "status" : "alert"}
          className={
            good
              ? "rounded-xl border border-emerald-300/60 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"
              : "rounded-xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          }
        >
          {t(notice)}
        </p>
      )}
      <ProjectWorkspace projectId={projectId} />
    </div>
  );
}
