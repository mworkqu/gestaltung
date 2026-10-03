"use client";

// Arabic translation controls (Phase E1, 2026-10-03), on Dashboard → Store →
// Sourcing overview. Two rows, both admin-only and never automatic:
//   names   — POST /api/admin/store-cleanup {step:"translate"}, repeated until
//             nothing is left (Arabic product names).
//   details — {step:"translate_details", after, force}, repeated with the
//             returned cursor until done (Arabic description + spec table).
// Each call is one server run of up to ~2–5 minutes; the page keeps calling
// and shows progress. "Stop" ends after the current call.

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Languages, Loader2, Square } from "lucide-react";

type NamesReply = { translated?: number; remaining?: number | null; error?: string };
type DetailsReply = {
  done?: boolean;
  processed?: number;
  translated?: number;
  failed?: number;
  failedSkus?: string[];
  remaining?: number | null;
  untranslated?: number | null;
  cursor?: string | null;
  error?: string;
};

async function post<T>(body: object): Promise<T> {
  const res = await fetch("/api/admin/store-cleanup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
  if (!res) return { error: "network" } as T;
  if (res.status === 403) return { error: "forbidden" } as T;
  const data = (await res.json().catch(() => null)) as T | null;
  return data ?? ({ error: `HTTP ${res.status}` } as T);
}

const button =
  "inline-flex items-center gap-1.5 rounded-full bg-cobalt px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50";
const stopButton =
  "inline-flex items-center gap-1.5 rounded-full border border-borderstrong px-4 py-1.5 text-sm font-medium text-heading hover:border-cobalt";

export function StoreTranslate() {
  const t = useTranslations("SourcingOverview");
  const stop = useRef(false);
  const [busy, setBusy] = useState<"names" | "details" | null>(null);
  const [force, setForce] = useState(false);
  const [namesMsg, setNamesMsg] = useState<string | null>(null);
  const [detailsMsg, setDetailsMsg] = useState<string | null>(null);

  const errorText = (e: string) => (t.has(`tr_err_${e}`) ? t(`tr_err_${e}`) : t("tr_err_other", { error: e }));

  const runNames = async () => {
    setBusy("names");
    stop.current = false;
    let total = 0;
    for (;;) {
      const r = await post<NamesReply>({ step: "translate" });
      if (r.error) {
        setNamesMsg(errorText(r.error));
        break;
      }
      total += r.translated ?? 0;
      const left = r.remaining ?? 0;
      setNamesMsg(t("tr_namesProgress", { done: total, left }));
      if (!left || !r.translated || stop.current) break;
    }
    setBusy(null);
  };

  const runDetails = async () => {
    setBusy("details");
    stop.current = false;
    let cursor: string | null = null;
    let processed = 0;
    let translated = 0;
    let failed = 0;
    for (;;) {
      const r: DetailsReply = await post<DetailsReply>({ step: "translate_details", force, after: cursor });
      processed += r.processed ?? 0;
      translated += r.translated ?? 0;
      failed += r.failed ?? 0;
      if (r.error) {
        setDetailsMsg(`${t("tr_detailsProgress", { processed, translated, failed, left: r.remaining ?? 0 })} ${errorText(r.error)}`);
        break;
      }
      cursor = r.cursor ?? cursor;
      if (r.done) {
        setDetailsMsg(t("tr_detailsDone", { translated, failed, untranslated: r.untranslated ?? 0 }));
        break;
      }
      setDetailsMsg(t("tr_detailsProgress", { processed, translated, failed, left: r.remaining ?? 0 }));
      if (stop.current) {
        setDetailsMsg(`${t("tr_detailsProgress", { processed, translated, failed, left: r.remaining ?? 0 })} ${t("tr_stopped")}`);
        break;
      }
      // A call that moved nothing would loop forever.
      if (!r.processed) break;
    }
    setBusy(null);
  };

  const row = (
    key: "names" | "details",
    run: () => void,
    msg: string | null,
    extra?: React.ReactNode
  ) => (
    <div className="flex flex-wrap items-center gap-3 py-3">
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold text-heading">{t(`tr_${key}Title`)}</span>
        <span className="block text-xs text-mutedtext">{t(`tr_${key}Help`)}</span>
      </span>
      {extra}
      {busy === key ? (
        <button type="button" onClick={() => (stop.current = true)} className={stopButton}>
          <Square className="h-4 w-4" />
          {t("tr_stop")}
        </button>
      ) : null}
      <button type="button" onClick={run} disabled={busy !== null} className={button}>
        {busy === key ? <Loader2 className="h-4 w-4 animate-spin" /> : <Languages className="h-4 w-4" />}
        {busy === key ? t("tr_running") : t("tr_run")}
      </button>
      {msg && (
        <p className="w-full text-sm text-heading" role="status">
          {msg}
        </p>
      )}
    </div>
  );

  return (
    <section className="neu divide-y divide-borderstrong/40 px-5 py-2">
      <div className="py-3">
        <h2 className="text-sm font-bold text-heading">{t("tr_title")}</h2>
        <p className="text-xs text-mutedtext">{t("tr_intro")}</p>
      </div>
      {row("names", runNames, namesMsg)}
      {row(
        "details",
        runDetails,
        detailsMsg,
        <label className="flex items-center gap-1.5 text-xs text-mutedtext">
          <input
            type="checkbox"
            checked={force}
            onChange={(e) => setForce(e.target.checked)}
            disabled={busy !== null}
            className="h-3.5 w-3.5 accent-cobalt"
          />
          {t("tr_force")}
        </label>
      )}
    </section>
  );
}
