"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";

import type { Locale } from "@/i18n/routing";
import { formatDateTime } from "@/lib/cad-champions/format";
import { formatCountdown, secondsLeft } from "@/lib/cad-champions/journey/test-status";

/** Live countdown to a test deadline. Digits are always Western and always left-to-right. */
export function Countdown({ deadlineIso }: { deadlineIso: string }) {
  const t = useTranslations("CC.dashboard.test");
  const locale = useLocale() as Locale;
  // Start from the deadline-derived value on the server render's clock-free path: null until mounted.
  const [left, setLeft] = React.useState<number | null>(null);

  React.useEffect(() => {
    const tick = () => setLeft(secondsLeft(deadlineIso));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [deadlineIso]);

  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold uppercase tracking-wide text-body rtl:tracking-normal">{t("timeLeft")}</p>
      {left === 0 ? (
        <p className="text-base font-bold text-ink" role="status">
          {t("timeUp")}
        </p>
      ) : (
        <p dir="ltr" className="text-start text-3xl font-extrabold tabular-nums text-heading" style={{ unicodeBidi: "isolate" }}>
          {left === null ? "--:--" : formatCountdown(left)}
        </p>
      )}
      <p className="text-sm text-body">{t("endsAt", { time: formatDateTime(deadlineIso, locale) })}</p>
    </div>
  );
}
