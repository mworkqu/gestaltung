"use client";

// Public holidays for delivery promises (P2-06, store_settings.holidays,
// migration 0054). The owner lists the dates (Eid, National Day …); handling,
// transit and buffer days skip them and the weekend (Fri + Sat), and no
// promised date lands on one. Save → upsert + revalidateStorefront().

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, Plus, Save, X } from "lucide-react";

import { saveHolidays } from "@/app/[locale]/dashboard/store/sourcing/actions";
import { isIsoDate, type Holidays } from "@/lib/store/working-days";

const input =
  "rounded-lg border border-white/60 bg-surface px-2 py-1 text-sm text-heading shadow-neu-inset outline-none focus:ring-2 focus:ring-cobalt/60";

function label(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-QA-u-nu-latn" : "en-GB", {
    weekday: "short",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${iso}T12:00:00Z`));
}

/** `initial` null = the holidays row does not exist yet (0054 not run). */
export function HolidaySettingsEditor({ locale, initial }: { locale: string; initial: Holidays | null }) {
  const t = useTranslations("Delivery");
  const router = useRouter();
  const [dates, setDates] = useState<string[]>(initial?.dates ?? []);
  const [draft, setDraft] = useState("");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const add = () => {
    if (!isIsoDate(draft)) {
      setMsg(t("holidaysInvalid"));
      return;
    }
    setDates((d) => Array.from(new Set([...d, draft])).sort());
    setDraft("");
    setMsg(null);
  };

  return (
    <div className="neu space-y-4 p-6">
      <div>
        <h2 className="text-lg font-bold text-heading">{t("holidaysTitle")}</h2>
        <p className="mt-1 text-xs text-mutedtext">{t("holidaysHelp")}</p>
      </div>
      {!initial ? (
        <p className="text-sm text-mutedtext">{t("holidaysNeedsMigration")}</p>
      ) : (
        <>
          {initial.weekend.join(",") === "5,6" && <p className="text-sm text-body">{t("holidaysWeekend")}</p>}
          {dates.length === 0 ? (
            <p className="text-sm text-mutedtext">{t("holidaysEmpty")}</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {dates.map((d) => (
                <li key={d} className="inline-flex items-center gap-1 rounded-full bg-panel py-1 pe-1 ps-3 text-sm text-heading shadow-neu-sm">
                  <span>{label(d, locale)}</span>
                  <button
                    type="button"
                    onClick={() => setDates((all) => all.filter((x) => x !== d))}
                    aria-label={t("holidaysRemove", { date: d })}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-full text-mutedtext hover:text-destructive max-md:h-11 max-md:w-11"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-sm text-body">
              {t("holidaysDate")}
              <input type="date" value={draft} onChange={(e) => setDraft(e.target.value)} className={input} dir="ltr" />
            </label>
            <button
              type="button"
              onClick={add}
              disabled={!draft}
              className="inline-flex items-center gap-1.5 rounded-full border border-borderstrong px-3 py-1.5 text-sm font-medium text-heading hover:border-cobalt hover:text-cobalt disabled:opacity-50 max-md:min-h-11"
            >
              <Plus className="h-4 w-4" />
              {t("holidaysAdd")}
            </button>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await saveHolidays(locale, dates);
                  if ("error" in r && r.error) {
                    setMsg(r.error === "run_0054" ? t("holidaysNeedsMigration") : r.error);
                    return;
                  }
                  if ("dates" in r && r.dates) setDates(r.dates);
                  setMsg(t("saved"));
                  router.refresh();
                })
              }
              className="inline-flex items-center gap-1.5 rounded-full bg-cobalt px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50 max-md:min-h-11"
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {t("save")}
            </button>
            {msg && <span className="text-sm text-mutedtext">{msg}</span>}
          </div>
        </>
      )}
    </div>
  );
}
