"use client";

// SkipCash return page (Prompt 10 Step E): "Confirming your payment..."
// while polling our server (which also asks SkipCash directly), then the
// status page. Stops after ~2 minutes with a calm "we'll email you".

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";

import { Alert, Button, Spinner } from "@/components/cad-champions/ui";
import type { Locale } from "@/i18n/routing";
import { ccPath } from "@/lib/cad-champions/routes";

const POLL_MS = 3000;
const MAX_POLLS = 40;

export function ReturnPoller({ paymentId }: { paymentId: string }) {
  const t = useTranslations("CC.payments.return");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [state, setState] = React.useState<"waiting" | "paid" | "failed" | "slow" | "missing">("waiting");
  const statusHref = ccPath(locale, `/account/payments/${paymentId}`);

  React.useEffect(() => {
    let polls = 0;
    let stop = false;
    let timer: number | undefined;
    async function tick() {
      polls++;
      try {
        const res = await fetch(`/api/cad-champions/payments/${paymentId}/status`, { cache: "no-store" });
        if (res.status === 404) {
          setState("missing");
          return;
        }
        const json = (await res.json().catch(() => null)) as { status?: string } | null;
        const s = json?.status;
        if (s === "paid") {
          setState("paid");
          timer = window.setTimeout(() => router.replace(statusHref), 1500);
          return;
        }
        if (s === "cancelled" || s === "expired") {
          setState("failed");
          return;
        }
      } catch {
        // network blip: keep polling
      }
      if (stop) return;
      if (polls >= MAX_POLLS) {
        setState("slow");
        return;
      }
      timer = window.setTimeout(tick, POLL_MS);
    }
    void tick();
    return () => {
      stop = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [paymentId, router, statusHref]);

  if (state === "paid") {
    return (
      <Alert tone="success" title={t("paid")}>
        {t("paidBody")}
      </Alert>
    );
  }
  if (state === "missing") return <Alert tone="error" title={t("missing")} />;
  if (state === "failed" || state === "slow") {
    return (
      <div className="space-y-4">
        <Alert tone={state === "failed" ? "warning" : "info"} title={state === "failed" ? t("failed") : t("slow")}>
          {state === "failed" ? t("failedBody") : null}
        </Alert>
        <Button asChild variant="secondary">
          <Link href={statusHref}>{t("openStatus")}</Link>
        </Button>
      </div>
    );
  }
  return (
    <div className="neu flex flex-col items-center gap-3 p-8 text-center" role="status" aria-live="polite">
      <Spinner label={t("waiting")} />
    </div>
  );
}
