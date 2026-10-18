"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import { ENGINEERING_BUCKET, ENGINEERING_MAX_BYTES, RETURN_EXTENSIONS } from "@/lib/engineering/config";
import { loadSupabase } from "@/lib/supabase/lazy";
import { cn } from "@/lib/utils";

// Full STEP file panel (Engineers level): request, follow, download, send back.
// A full STEP file of the whole project is generated for the user by our engineers.

export type JobView = {
  id: string;
  /** step_model, or an engineer service (0092): assembly | cad_engineer | pcb_gerber. */
  kind: string;
  status: string;
  createdLabel: string;
  etaLabel: string | null;
  resultName: string | null;
  /** Signed on the server (1 hour), only for the viewer's own ready job. */
  downloadUrl: string | null;
  returned: boolean;
};

const CHIP: Record<string, string> = {
  queued: "bg-amber-100 text-amber-900",
  in_progress: "bg-sky-100 text-sky-900",
  ready: "bg-emerald-100 text-emerald-900",
  failed: "bg-red-100 text-red-900",
  cancelled: "bg-panel text-mutedtext",
};

const btn =
  "inline-flex min-h-11 items-center justify-center rounded-full px-5 text-sm font-semibold transition-colors disabled:opacity-60";
const primary = cn(btn, "bg-cobalt text-white hover:bg-cobalt-hover");
const quiet = cn(btn, "bg-panel text-heading shadow-neu hover:text-cobalt");

export function StepPanel({
  projectId,
  userId,
  signedIn,
  tokens,
  etaMin,
  etaMax,
  jobs,
}: {
  projectId: string;
  userId: string;
  signedIn: boolean;
  tokens: number;
  etaMin: number;
  etaMax: number;
  jobs: JobView[];
}) {
  const t = useTranslations("Engineering");
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<"no_tokens" | "already_open" | "failed" | "bad_file" | "too_big" | null>(null);
  const hasOpen = jobs.some((j) => j.kind === "step_model" && (j.status === "queued" || j.status === "in_progress"));

  async function request() {
    setBusy("request");
    setError(null);
    try {
      const res = await fetch("/api/engineering/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, note }),
      });
      if (res.ok) {
        setNote("");
        router.refresh();
      } else {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error === "no_tokens" ? "no_tokens" : body?.error === "already_open" ? "already_open" : "failed");
      }
    } catch {
      setError("failed");
    } finally {
      setBusy(null);
    }
  }

  async function cancel(id: string) {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/engineering/jobs/${id}/cancel`, { method: "POST" });
      if (!res.ok) setError("failed");
      router.refresh();
    } catch {
      setError("failed");
    } finally {
      setBusy(null);
    }
  }

  async function sendBack(id: string, file: File) {
    setError(null);
    const lower = file.name.toLowerCase();
    if (!RETURN_EXTENSIONS.some((e) => lower.endsWith(e))) return setError("bad_file");
    if (file.size > ENGINEERING_MAX_BYTES) return setError("too_big");
    setBusy(id);
    try {
      const safe = file.name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(-80);
      const path = `${userId}/${id}/${Date.now()}-${safe}`;
      const supabase = await loadSupabase();
      const up = await supabase.storage.from(ENGINEERING_BUCKET).upload(path, file, { upsert: false });
      if (up.error) throw up.error;
      const res = await fetch(`/api/engineering/jobs/${id}/return`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      if (!res.ok) throw new Error("return failed");
      router.refresh();
    } catch {
      setError("failed");
    } finally {
      setBusy(null);
    }
  }

  const errorText = error ? t(`err_${error}`) : null;

  return (
    <section className="neu space-y-5 p-6" data-testid="engineering-step-panel">
      <div className="space-y-2">
        <h2 className="text-base font-bold text-heading">{t("stepTitle")}</h2>
        <p className="max-w-[65ch] text-sm leading-relaxed text-body">{t("stepIntro", { min: String(etaMin), max: String(etaMax) })}</p>
      </div>

      {!signedIn ? (
        <p className="text-sm font-medium text-mutedtext">{t("stepSignIn")}</p>
      ) : (
        <div className="tile space-y-3">
          <p className="text-sm font-semibold text-heading">{t("stepCost", { n: String(tokens) })}</p>
          <label className="block space-y-1">
            <span className="text-xs font-semibold text-mutedtext">{t("noteLabel")}</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={1000}
              rows={3}
              placeholder={t("notePlaceholder")}
              className="w-full rounded-xl border border-border bg-background p-3 text-sm text-body"
              dir="auto"
            />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className={primary} disabled={busy !== null || hasOpen} onClick={request}>
              {t("requestStep")}
            </button>
            {hasOpen && <span className="text-xs text-mutedtext">{t("alreadyOpen")}</span>}
          </div>
        </div>
      )}

      {errorText && (
        <p role="alert" className="text-sm font-semibold text-red-700">
          {errorText}{" "}
          {error === "no_tokens" && (
            <Link href="/tokens" className="text-cobalt underline">
              {t("getTokens")}
            </Link>
          )}
        </p>
      )}

      {jobs.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-bold text-heading">{t("jobsTitle")}</h3>
          <ul className="space-y-3">
            {jobs.map((j) => (
              <li key={j.id} className="tile space-y-3" data-testid="engineering-job" data-status={j.status}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-bold text-heading">{t(`kind_${j.kind}`)}</span>
                  <span className={cn("rounded-full px-3 py-1 text-xs font-bold", CHIP[j.status] ?? CHIP.cancelled)}>{t(`status_${j.status}`)}</span>
                  <span className="text-xs text-mutedtext">
                    {t("requestedAt")} <span className="font-mono tabular-nums">{j.createdLabel}</span>
                    {j.etaLabel && (j.status === "queued" || j.status === "in_progress") && (
                      <>
                        {" · "}
                        {t("etaAt")} <span className="font-mono tabular-nums">{j.etaLabel}</span>
                      </>
                    )}
                  </span>
                </div>

                {j.status === "queued" && (
                  <button type="button" className={quiet} disabled={busy !== null} onClick={() => cancel(j.id)}>
                    {t("cancelJob")}
                  </button>
                )}

                {j.status === "ready" && (
                  <div className="space-y-3">
                    {j.downloadUrl ? (
                      <a href={j.downloadUrl} className={cn(primary, "w-full sm:w-auto")} download>
                        {t("download")}
                        {j.resultName ? ` · ${j.resultName}` : ""}
                      </a>
                    ) : (
                      <p className="text-xs text-mutedtext">{t("downloadUnavailable")}</p>
                    )}
                    {j.returned ? (
                      <p className="text-sm font-semibold text-emerald-700">{t("sentBack")}</p>
                    ) : (
                      <label className="block space-y-1">
                        <span className="text-xs font-semibold text-mutedtext">{t("uploadLabel")}</span>
                        <input
                          type="file"
                          accept={RETURN_EXTENSIONS.join(",")}
                          disabled={busy !== null}
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            e.target.value = "";
                            if (f) void sendBack(j.id, f);
                          }}
                          className="block w-full text-sm text-body file:me-3 file:min-h-11 file:rounded-full file:border-0 file:bg-panel file:px-4 file:text-sm file:font-semibold file:text-heading file:shadow-neu"
                        />
                        <span className="block text-xs text-faint">{t("uploadHint")}</span>
                      </label>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
