"use client";

// 3D model (CAD). Describe → cost dialog → /api/cad (Gemini writes OpenSCAD;
// nothing is spent) → the BROWSER builds it (lib/cad/render.ts) → only then
// cad_deliver spends (1 cad credit opens a session of 3 versions; admin is
// never charged) → viewer + downloads. A build failure is reported
// (cad_fail) and repaired once automatically; a failed generation never
// charges. Saved versions re-open from their stored code — no AI call, no
// charge. Before migration 0043 the card keeps the stub: Confirm stores the
// tier (set_cad_request) and generates nothing.

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useLocale, useTranslations } from "next-intl";
import { Box, Check, Download, Loader2, Wand2 } from "lucide-react";

import { Card, PrimaryButton, SoftButton, Warn, fieldClass } from "@/components/prototyping/ui";
import { Link } from "@/i18n/navigation";
import { AccessNote, CostLabel } from "@/components/credits/access-note";
import { FeatureVideoClient } from "@/components/feature-video-client";
import { classifyCadRequest, type CadTier } from "@/lib/credits/classify";
import { CAD_GENERATIONS, CREDIT_QAR, REDEEM_DAYS } from "@/lib/credits/constants";
import { creditsChanged, useCanUse } from "@/lib/credits/use-credits";
import { renderScad, stlStats } from "@/lib/cad/render";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const CadViewer = dynamic(() => import("./cad-viewer"), {
  ssr: false,
  loading: () => <div className="h-72 w-full sm:h-80" />,
});

type Version = { id: string; request: string; scad: string };
type Built = { id: string; stl: ArrayBuffer; size: [number, number, number] };
type Phase = "idle" | "opening" | "writing" | "building" | "repairing" | "done";
type Pending = { tier: CadTier; engine: string; request: string; parentId: string | null };
type Problem = { code: string; log?: string };

/** The table is not there yet: migration 0043 has not run. */
const tableMissing = (e: { code?: string; message?: string }) =>
  e.code === "PGRST205" || e.code === "42P01" || /could not find the table|does not exist/i.test(e.message ?? "");

const ERROR_KEY: Record<string, string> = {
  too_many_failed: "cadErr_too_many",
  paused: "cadErr_busy",
  rate_limited: "cadErr_busy",
  unavailable: "cadErr_unavailable",
  invalid: "cadErr_invalid",
  render: "cadErr_render",
  timeout: "cadErr_timeout",
  load: "cadErr_load",
  deliver: "cadErr_deliver",
  open: "cadErr_open",
};

function download(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function CadCard({ projectId, brief }: { projectId: string; brief: string }) {
  const t = useTranslations("Credits");
  const locale = useLocale();
  const access = useCanUse("cad", projectId);
  const [description, setDescription] = useState(brief);
  const [dialog, setDialog] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<CadTier | null>(null);
  const [error, setError] = useState(false);
  const [blocked, setBlocked] = useState<string | null>(null);

  const [mode, setMode] = useState<"checking" | "live" | "stub">("checking");
  const [versions, setVersions] = useState<Version[]>([]);
  const [built, setBuilt] = useState<Built | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [problem, setProblem] = useState<Problem | null>(null);
  const [refine, setRefine] = useState("");
  const openToken = useRef(0);

  const working = phase !== "idle" && phase !== "done";
  const current = built ? versions.find((v) => v.id === built.id) ?? null : null;
  const currentIndex = current ? versions.indexOf(current) : -1;

  /** Re-open a saved version from its stored code: no AI call, no charge. */
  const open = useCallback(async (v: Version) => {
    const token = ++openToken.current;
    setProblem(null);
    setSummary(null);
    setPhase("opening");
    const r = await renderScad(v.scad);
    if (token !== openToken.current) return;
    setPhase("idle");
    const stats = r.ok ? stlStats(r.stl) : null;
    if (!r.ok || !stats) return setProblem({ code: !r.ok && r.error !== "render" ? r.error : "open", log: r.ok ? undefined : r.log });
    setBuilt({ id: v.id, stl: r.stl, size: stats.size });
  }, []);

  useEffect(() => {
    let gone = false;
    (async () => {
      const { data, error: e } = await createClient()
        .from("cad_generations")
        .select("id, request, scad")
        .eq("project_id", projectId)
        .eq("status", "delivered")
        .order("created_at", { ascending: true });
      if (gone) return;
      if (e) return setMode(tableMissing(e) ? "stub" : "live");
      setMode("live");
      const rows = ((data ?? []) as Version[]).filter((v) => v.scad);
      setVersions(rows);
      const last = rows[rows.length - 1];
      if (last) void open(last);
    })();
    return () => {
      gone = true;
    };
  }, [projectId, open]);

  function fail(code: string, log?: string) {
    setProblem({ code, log });
    setPhase("idle");
  }

  /** The stub stage (before 0043): store the tier, generate nothing. */
  async function stubConfirm(tier: CadTier) {
    setBusy(true);
    const { error: e } = await createClient().rpc("set_cad_request", { p_project: projectId, p_tier: tier });
    setBusy(false);
    if (e) setError(true);
    else setDone(tier);
  }

  /**
   * Write → build → deliver. parentId refines that version; repair rebuilds a
   * version whose build failed (request = OpenSCAD's output). label is what
   * the version list shows.
   */
  async function generate(request: string, parentId: string | null, label: string, repair = false) {
    openToken.current++;
    setProblem(null);
    setBlocked(null);
    setPhase(repair ? "repairing" : "writing");
    const supabase = createClient();

    let body: { id?: string; scad?: string; summary?: string; error?: string } = {};
    try {
      const res = await fetch("/api/cad", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId, request, parentId, repair, locale }),
      });
      body = await res.json().catch(() => ({ error: "failed" }));
      if (!res.ok && !body.error) body.error = "failed";
    } catch {
      body = { error: "unavailable" };
    }
    if (body.error || !body.id || !body.scad) {
      const code = body.error ?? "failed";
      if (code === "needs_migration") {
        setMode("stub");
        setPhase("idle");
        return stubConfirm(classifyCadRequest(label).tier);
      }
      if (code === "sign_in" || code === "no_credits") {
        setBlocked(code);
        return setPhase("idle");
      }
      return fail(code);
    }
    const { id, scad } = body;

    setPhase(repair ? "repairing" : "building");
    const r = await renderScad(scad);
    const stats = r.ok ? stlStats(r.stl) : null;
    if (!r.ok || !stats || !stats.triangles) {
      const code = r.ok ? "render" : r.error;
      const log = r.ok ? "OpenSCAD produced an empty model." : r.log || "OpenSCAD produced no solid.";
      await supabase.rpc("cad_fail", { p_id: id, p_error: `${code}: ${log.slice(-480)}` });
      // One automatic repair, with OpenSCAD's own words. A failed CDN load is not the code's fault.
      if (!repair && code !== "load") return generate(log.slice(-3000), id, label, true);
      return fail(code, log);
    }

    const { error: e } = await supabase.rpc("cad_deliver", { p_id: id });
    if (e) {
      const reason = (["sign_in", "no_credits"] as const).find((c) => e.message?.includes(c));
      if (reason) {
        setBlocked(reason);
        return setPhase("idle");
      }
      return fail("deliver");
    }
    creditsChanged();
    setVersions((vs) => [...vs, { id, request: label, scad }]);
    setBuilt({ id, stl: r.stl, size: stats.size });
    setSummary(body.summary || null);
    setRefine("");
    setPhase("done");
  }

  function gate(): boolean {
    setDone(null);
    setError(false);
    setProblem(null);
    if (access && !access.allowed) {
      setBlocked(access.reason);
      return false;
    }
    setBlocked(null);
    return true;
  }

  function start() {
    if (!gate()) return;
    setDialog({ ...classifyCadRequest(description), request: description.trim(), parentId: null });
  }

  /** Refinements skip the dialog while they are included; a new session asks again. */
  function startRefine() {
    const request = refine.trim();
    if (!request || !current || !gate()) return;
    if (access?.cost === "credit") setDialog({ ...classifyCadRequest(request), request, parentId: current.id });
    else void generate(request, current.id, request);
  }

  async function confirm() {
    if (!dialog) return;
    const d = dialog;
    if (mode === "stub") {
      await stubConfirm(d.tier);
      setDialog(null);
      return;
    }
    setDialog(null);
    await generate(d.request, d.parentId, d.request);
  }

  const mm = (n: number) => n.toFixed(1);
  const steps: { key: "writing" | "building" | "done"; label: string }[] = [
    { key: "writing", label: t("cadStepWriting") },
    { key: "building", label: phase === "repairing" ? t("cadStepRepairing") : t("cadStepBuilding") },
    { key: "done", label: t("cadStepDone") },
  ];
  const activeStep = phase === "writing" ? 0 : phase === "done" ? 3 : 1;

  return (
    <Card
      kicker={t("cadKicker")}
      title={t("cadTitle")}
      intro={t("cadIntro", { n: CAD_GENERATIONS })}
      actions={
        <>
          <CostLabel cost={access?.cost} regens={access?.regens} />
          <PrimaryButton onClick={start} disabled={!description.trim() || working || mode === "checking"}>
            <Box className="h-3.5 w-3.5" />
            {t("cadButton")}
          </PrimaryButton>
        </>
      }
    >
      <label className="block space-y-1.5">
        <span className="text-xs font-semibold text-heading">{t("cadDescribe")}</span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className={fieldClass}
          placeholder={t("cadPlaceholder")}
        />
      </label>
      {/* Before the first generation: what you get (poster first, click to play). */}
      {built === null && versions.length === 0 && (
        <div className="max-w-md">
          <FeatureVideoClient slug="cad-model" size="small" posterOnly />
        </div>
      )}
      <AccessNote reason={blocked} step="cad" />
      {done && <p className="rounded-xl bg-buy-bg px-3 py-2 text-xs font-medium text-buy">{t("cadStub", { tier: t(`tier_${done}`) })}</p>}
      {error && <p className="text-xs text-destructive">{t("cadError")}</p>}

      {phase === "opening" && (
        <p className="flex items-center gap-2 text-xs text-mutedtext">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t("cadOpening")}
        </p>
      )}
      {(phase === "writing" || phase === "building" || phase === "repairing" || phase === "done") && (
        <ol className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl bg-panel px-4 py-3 text-xs shadow-neu-inset" aria-live="polite">
          {steps.map((s, i) => (
            <li
              key={s.key}
              className={cn(
                "flex items-center gap-1.5",
                i < activeStep ? "text-buy" : i === activeStep ? "font-semibold text-heading" : "text-faint"
              )}
            >
              {i < activeStep ? (
                <Check className="h-3.5 w-3.5" />
              ) : i === activeStep ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-cobalt" />
              ) : (
                <span className="h-1.5 w-1.5 rounded-full bg-current" />
              )}
              {s.label}
            </li>
          ))}
        </ol>
      )}

      {problem && (
        <Warn blocking>
          {t(ERROR_KEY[problem.code] ?? "cadErr_failed")}
          {problem.log && (
            <details className="mt-1">
              <summary className="cursor-pointer font-semibold">{t("cadErrDetails")}</summary>
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[10.5px]" dir="ltr">
                {problem.log.slice(-1500)}
              </pre>
            </details>
          )}
        </Warn>
      )}

      {built && (
        <div className="space-y-3">
          <div className="neu-inset overflow-hidden">
            <CadViewer stl={built.stl} label={t("cadTitle")} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-mutedtext">
            <span dir="ltr" className="font-mono">
              {t("cadSize", { x: mm(built.size[0]), y: mm(built.size[1]), z: mm(built.size[2]) })}
            </span>
            <span>{t("cadViewerHint")}</span>
          </div>
          {summary && <p className="text-sm text-body">{summary}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <SoftButton onClick={() => download(`gestaltung-cad-v${currentIndex + 1}.stl`, built.stl, "model/stl")}>
              <Download className="h-3.5 w-3.5" />
              {t("cadDownloadStl")}
            </SoftButton>
            {current && (
              <SoftButton onClick={() => download(`gestaltung-cad-v${currentIndex + 1}.scad`, current.scad, "text/plain")}>
                <Download className="h-3.5 w-3.5" />
                {t("cadDownloadScad")}
              </SoftButton>
            )}
          </div>
        </div>
      )}

      {versions.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-heading">{t("cadVersions")}</p>
          <ul className="space-y-1">
            {versions.map((v, i) => (
              <li key={v.id}>
                <button
                  type="button"
                  disabled={working}
                  onClick={() => void open(v)}
                  className={cn(
                    "flex w-full items-baseline gap-2 rounded-lg px-2.5 py-1.5 text-start text-xs transition-colors disabled:opacity-60",
                    v.id === built?.id ? "bg-cobalt/10 text-heading" : "text-mutedtext hover:text-heading"
                  )}
                >
                  <span className="shrink-0 font-semibold text-cobalt">
                    {t("cadVersion", { n: i + 1 })}
                  </span>
                  <span className="min-w-0 truncate">{v.request}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {current && (
        <div className="space-y-1.5">
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-heading">{t("cadRefineLabel")}</span>
            <textarea
              value={refine}
              onChange={(e) => setRefine(e.target.value)}
              rows={2}
              className={fieldClass}
              placeholder={t("cadRefinePlaceholder")}
            />
          </label>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {access?.cost === "included" && (
              <span className="text-xs text-mutedtext">
                {t("cadVersionsLeft", { n: access.regens ?? 0, total: CAD_GENERATIONS })}
              </span>
            )}
            {access?.cost === "credit" && <CostLabel cost={access.cost} />}
            <PrimaryButton onClick={startRefine} disabled={!refine.trim() || working}>
              <Wand2 className="h-3.5 w-3.5" />
              {t("cadRefineButton")}
            </PrimaryButton>
          </div>
        </div>
      )}

      {dialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cad-dialog-title"
          onClick={() => !busy && setDialog(null)}
        >
          <div className="neu w-full max-w-md space-y-4 p-6" onClick={(e) => e.stopPropagation()}>
            <h2 id="cad-dialog-title" className="text-lg font-bold text-heading">
              {t("cadDialogTitle")}
            </h2>
            <p className="text-sm leading-relaxed text-body">
              {access?.cost === "included"
                ? t("cadDialogIncluded", { tier: t(`tier_${dialog.tier}`), n: access.regens ?? 0 })
                : access?.cost === "none"
                  ? t("cadDialogAdmin", { tier: t(`tier_${dialog.tier}`) })
                  : t("cadDialogBody", { tier: t(`tier_${dialog.tier}`), qar: CREDIT_QAR, days: REDEEM_DAYS })}
            </p>
            <Link
              href="/pricing#credits"
              target="_blank"
              className="inline-flex min-h-11 items-center text-sm font-semibold text-cobalt hover:text-cobalt-hover"
            >
              {t("howCreditsLink")}
            </Link>
            <div className="flex items-center justify-end gap-3">
              <SoftButton onClick={() => setDialog(null)} disabled={busy}>
                {t("cancel")}
              </SoftButton>
              <PrimaryButton onClick={confirm} disabled={busy}>
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {t("confirm")}
              </PrimaryButton>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
