"use client";

// "Have an invite code?" on /pricing#credits (price experiment, P4-02 / WF-42).
//
// Display only: credits are still paid by bank transfer or in person and added
// by hand, so a valid code just shows the invited credit price. The page stays
// static: the code is read from window.location.search in an effect (like the
// contact form), never from searchParams. Checking a code is a READ
// (price_experiment_quote) through the browser client with no session created;
// only when a session already exists (useAuth) is the code also claimed for the
// account (claim_price_cohort, first code wins). Off / unknown code / RPCs not
// there yet (before migration 0060) all answer "This code is not active."

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { normaliseCode, parseQuote, readCodeFromSearch, storeCode } from "@/lib/pricing/experiment";
import { formatQar } from "@/lib/pricing/plans";

type Status =
  | { phase: "idle" }
  | { phase: "checking" }
  | { phase: "inactive" }
  | { phase: "active"; code: string; invited: number };

const fieldClass =
  "w-full rounded-xl border border-white/60 bg-panel px-4 py-3 text-sm text-heading shadow-neu-inset transition placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-cobalt/60";

export function InvitePrice({ listed }: { /** The listed credit price (store_settings pricing_plans.overage_per_credit_qar). */ listed: number }) {
  const t = useTranslations("PriceInvite");
  const { ready, user } = useAuth();
  const userId = ready ? (user?.id ?? null) : null;

  const [input, setInput] = useState("");
  const [status, setStatus] = useState<Status>({ phase: "idle" });
  const [saved, setSaved] = useState(false);
  const run = useRef(0);
  const claimed = useRef<string | null>(null);

  const apply = useCallback(async (raw: string) => {
    const my = ++run.current;
    const code = normaliseCode(raw);
    if (!code) {
      setStatus({ phase: "inactive" });
      return;
    }
    setStatus({ phase: "checking" });
    setSaved(false);
    claimed.current = null;
    let invited: number | null = null;
    try {
      const res = await createClient().rpc("price_experiment_quote", { p_code: code });
      invited = res.error ? null : parseQuote(res.data);
    } catch {
      invited = null;
    }
    if (my !== run.current) return;
    if (invited === null) {
      setStatus({ phase: "inactive" });
      return;
    }
    storeCode(code);
    setStatus({ phase: "active", code, invited });
  }, []);

  // A code in the link applies by itself.
  useEffect(() => {
    const code = readCodeFromSearch(window.location.search);
    if (!code) return;
    setInput(code);
    void apply(code);
  }, [apply]);

  // With a session already in place, also keep the code on the account.
  useEffect(() => {
    if (status.phase !== "active" || !userId || claimed.current === status.code) return;
    claimed.current = status.code;
    const { code } = status;
    const my = run.current;
    void (async () => {
      try {
        const res = await createClient().rpc("claim_price_cohort", { p_code: code });
        if (!res.error && parseQuote(res.data) !== null && my === run.current) setSaved(true);
      } catch {
        // the code stays in this browser; AccessNote claims it later
      }
    })();
  }, [status, userId]);

  return (
    <div className="tile space-y-3">
      <div className="space-y-1">
        <h3 className="title-card">{t("title")}</h3>
        <p className="text-sm leading-relaxed text-mutedtext">{t("hint")}</p>
      </div>
      <form
        className="flex flex-col gap-3 sm:flex-row sm:items-center"
        onSubmit={(e) => {
          e.preventDefault();
          void apply(input);
        }}
      >
        <label htmlFor="invite-code" className="sr-only">
          {t("label")}
        </label>
        <input
          id="invite-code"
          type="text"
          dir="ltr"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={40}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t("placeholder")}
          className={`${fieldClass} sm:max-w-xs`}
        />
        <Button type="submit" variant="outline" className="rounded-full" disabled={!input.trim() || status.phase === "checking"}>
          {status.phase === "checking" ? t("checking") : t("apply")}
        </Button>
      </form>
      <div aria-live="polite" className="text-sm">
        {status.phase === "active" && (
          <>
            <p className="font-semibold tabular-nums text-heading">
              {t("quoted", { invited: formatQar(status.invited), listed: formatQar(listed) })}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-mutedtext">{t("payNote")}</p>
            {saved && <p className="mt-1 text-xs font-semibold text-cobalt">{t("saved")}</p>}
          </>
        )}
        {status.phase === "inactive" && <p className="text-mutedtext">{t("inactive")}</p>}
      </div>
    </div>
  );
}
