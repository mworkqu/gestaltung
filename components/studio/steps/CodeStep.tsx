"use client";

// Step 6 · Your code (P5-14). Real starter firmware for the board the visitor
// chose: on entry with wiring and no doc.firmware → POST /api/studio/firmware
// (free, like /api/firmware; the pins come from OUR wiring). Shows the board,
// a short plain list of steps (when the server sent them), the code in a
// left-to-right monospace block that scrolls sideways, and "Copy code" as the
// secondary action; the main button stays "Next". No wiring yet → "Draw your
// wiring first" with a way back.

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Code2, Copy, Download, RefreshCw, X } from "lucide-react";

import { useStudioLibrary } from "../StudioLibraryProvider";
import { STEP_ACCENT } from "@/lib/studio/palette";
import type { StudioDoc } from "@/lib/studio/schema";
import type { StudioFirmware } from "@/lib/studio/client/api";
import type { StudioCtx } from "../StudioShell";
import { Bar, linkCls, MainButton, Problem, StepFrame } from "../ui";
import { buildConnections, pinConstants } from "@/lib/studio/connections";
import { focusLines, lineLinks, pinDiffLines, syncPinBlock, type DiffLine } from "@/lib/studio/code-link";
import type { WokwiResult } from "@/lib/studio/wokwi";
import { CodeLines } from "./code/CodeLines";

const accent = STEP_ACCENT.code;

export function CodeStep({
  ctx,
  doc,
  beforeServer,
  onFirmware,
  onNext,
  onWiring,
  focusId,
  onShowInWiring,
}: {
  ctx: StudioCtx;
  doc: StudioDoc;
  beforeServer: () => Promise<void>;
  onFirmware: (firmware: { board: string; code: string }, serverVersion: number | null) => void;
  onNext: () => void;
  /** Go back to the Wiring step. */
  onWiring: () => void;
  /** P5-17: a wire to scroll to and highlight ("Show in code" from the Wiring step). */
  focusId?: string | null;
  /** P5-17: open the Wiring step with this wire selected. */
  onShowInWiring?: (id: string) => void;
}) {
  const { getPart } = useStudioLibrary();
  const t = useTranslations("Studio");
  const tv = useTranslations("Studio.views");
  const mcu = doc.components.map((c) => getPart(c.partId)).find((p) => p?.category === "mcu");
  const wired = doc.netlist.nets.length > 0 && doc.checks.length > 0;
  const firmware = doc.firmware ?? null;

  const [extra, setExtra] = useState<Pick<StudioFirmware, "steps" | "libraries"> | null>(null);
  const [state, setState] = useState<"idle" | "writing" | "failed">("idle");
  const [copied, setCopied] = useState(false);
  const started = useRef(false);

  // P5-17: the wires and their pin constants, from the same netlist as every wiring view.
  const connections = useMemo(
    () => (wired ? buildConnections(doc.components, doc.netlist.nets, getPart) : []),
    [wired, doc.components, doc.netlist.nets, getPart],
  );
  const byId = useMemo(() => new Map(connections.map((c) => [c.id, c])), [connections]);
  const constants = useMemo(() => pinConstants(connections, getPart), [connections, getPart]);
  const code = firmware?.code ?? "";
  const links = useMemo(() => lineLinks(code, constants), [code, constants]);

  // "Pins updated": the wiring changed but the board did not (the shell kept the code).
  // Only the pin block is replaced — free, no AI — and the client's own edits stay.
  const [pinDiff, setPinDiff] = useState<DiffLine[] | null>(null);
  const synced = useRef<string | null>(null);
  useEffect(() => {
    if (!firmware || state === "writing") return;
    const key = `${firmware.code}\u0000${JSON.stringify(constants)}`;
    if (synced.current === key) return;
    synced.current = key;
    const r = syncPinBlock(firmware.code, connections, getPart);
    if (!r.changed) return;
    setPinDiff(pinDiffLines(r.removed, r.added));
    onFirmware({ board: firmware.board, code: r.code }, null);
  }, [firmware, connections, constants, getPart, onFirmware, state]);

  // "Show in code": highlight every line of that wire for a few seconds.
  const [focus, setFocus] = useState<{ id: string; lines: number[]; faded?: boolean } | null>(null);
  useEffect(() => {
    if (!focusId || !code) return;
    const lines = focusLines(code, focusId, constants);
    setFocus({ id: focusId, lines });
    if (!lines.length) return; // power / ground: the note stays until another wire is picked
    const first = lines[0];
    const raf = requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-testid="studio-code-line"][data-line="${first + 1}"]`);
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      el?.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
    });
    const timer = setTimeout(() => setFocus((f) => (f && f.id === focusId ? { ...f, lines: [], faded: true } : f)), 4000);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per request / code
  }, [focusId, code]);
  const highlight = useMemo(() => new Set(focus?.lines ?? []), [focus]);
  const powerNote =
    !!focus && !focus.faded && focus.lines.length === 0 && !!byId.get(focus.id) && !constants.some((c) => c.connectionIds.includes(focus.id));

  // Wokwi export: worked out on demand (module loaded after the code shows), hidden when unsupported.
  const [wokwi, setWokwi] = useState<WokwiResult | null>(null);
  const [wokwiFailed, setWokwiFailed] = useState(false);
  useEffect(() => {
    if (!firmware || !connections.length) {
      setWokwi(null);
      return;
    }
    let live = true;
    void import("@/lib/studio/wokwi")
      .then((m) => {
        if (live) setWokwi(m.wokwiDiagram(doc.components, connections, doc.netlist.nets, getPart));
      })
      .catch(() => {
        if (live) setWokwi(null);
      });
    return () => {
      live = false;
    };
  }, [firmware, connections, doc.components, doc.netlist.nets, getPart]);

  async function downloadWokwi() {
    if (!firmware || !wokwi?.ok) return;
    setWokwiFailed(false);
    try {
      const [{ wokwiFiles }, { zipStore }] = await Promise.all([import("@/lib/studio/wokwi"), import("@/lib/studio/zip")]);
      const bytes = zipStore(wokwiFiles(wokwi.diagram, firmware.code));
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/zip" }));
      const a = document.createElement("a");
      const slug = (doc.spec.name || "project").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "project";
      a.href = url;
      a.download = `${slug}-wokwi.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setWokwiFailed(true);
    }
  }

  async function write() {
    setState("writing");
    await beforeServer();
    const r = await ctx.api.firmware(doc.spec, doc.components, ctx.locale);
    if (!r.ok) {
      setState("failed");
      return;
    }
    setExtra({ steps: r.data.firmware.steps, libraries: r.data.firmware.libraries });
    onFirmware({ board: r.data.firmware.board, code: r.data.firmware.code }, r.data.docVersion);
    setState("idle");
  }

  useEffect(() => {
    if (!wired || firmware || started.current) return;
    started.current = true;
    void write();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per visit
  }, [wired, firmware]);

  async function copy() {
    if (!firmware) return;
    try {
      await navigator.clipboard.writeText(firmware.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked: the code stays selectable */
    }
  }

  if (!wired) {
    return (
      <StepFrame
        step="code"
        n={ctx.n("code")}
        title={t("title_code")}
        headline={t("codeWiringFirst")}
        intro={t("codeWiringFirstText")}
        footer={<MainButton onClick={onWiring}>{t("codeBackToWiring")}</MainButton>}
      >
        <div className="tile flex items-center gap-4 border-0 p-5" style={{ background: `linear-gradient(135deg, ${accent.soft}, #eef2f7 75%)` }}>
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-surface shadow-neu-sm">
            <Code2 className="h-6 w-6" style={{ color: accent.ink }} strokeWidth={1.5} aria-hidden />
          </span>
          <p className="text-base font-bold text-heading">{t("codeWiringFirst")}</p>
        </div>
      </StepFrame>
    );
  }

  const board = firmware?.board || mcu?.name[ctx.locale] || "";
  const steps = extra?.steps?.filter(Boolean).slice(0, 6) ?? [];

  return (
    <StepFrame
      step="code"
      n={ctx.n("code")}
      title={t("title_code")}
      headline={t("headline_code")}
      intro={t("intro_code")}
      footer={<MainButton onClick={onNext}>{t("next")}</MainButton>}
      secondary={
        firmware ? (
          <button type="button" className={linkCls} onClick={() => void copy()} data-testid="studio-copy-code">
            {copied ? <Check className="h-4 w-4" strokeWidth={2} aria-hidden /> : <Copy className="h-4 w-4" strokeWidth={1.75} aria-hidden />}
            {copied ? t("copied") : t("copyCode")}
          </button>
        ) : state === "failed" ? (
          <button type="button" className={linkCls} onClick={() => void write()}>
            <RefreshCw className="h-4 w-4" strokeWidth={1.75} aria-hidden />
            {t("tryAgain")}
          </button>
        ) : null
      }
    >
      {board && (
        <div className="tile flex items-center gap-4 border-0 p-4" style={{ background: `linear-gradient(135deg, ${accent.soft}, #eef2f7 75%)` }}>
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-surface shadow-neu-sm">
            <Code2 className="h-5 w-5" style={{ color: accent.ink }} strokeWidth={1.5} aria-hidden />
          </span>
          <p className="min-w-0 text-base font-bold text-heading" data-testid="studio-code-board">
            {t("codeFor", { board })}
          </p>
        </div>
      )}

      {firmware ? (
        <>
          {steps.length > 0 && (
            <div className="space-y-2">
              <h2 className="text-sm font-bold text-heading">{t("codeSteps")}</h2>
              <ol className="list-decimal space-y-1 ps-5 text-sm text-body">
                {steps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            </div>
          )}
          {pinDiff && (
            <div className="tile space-y-2 border-0 p-4" role="status" data-testid="studio-pins-updated" style={{ background: accent.soft }}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-heading">{tv("code.pinsUpdated")}</p>
                  <p className="text-sm text-body">{tv("code.pinsUpdatedText")}</p>
                </div>
                <button
                  type="button"
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-mutedtext hover:text-heading"
                  onClick={() => setPinDiff(null)}
                  aria-label={tv("code.dismiss")}
                >
                  <X className="h-4 w-4" strokeWidth={1.75} aria-hidden />
                </button>
              </div>
              {pinDiff.length > 0 && (
                <ul dir="ltr" className="overflow-x-auto rounded-xl bg-[#1c2434] px-3 py-2 text-start font-mono text-xs leading-relaxed">
                  {pinDiff.map((d, i) => (
                    <li key={i} className={d.kind === "removed" ? "whitespace-pre text-[#fca5a5] line-through" : "whitespace-pre text-[#86efac]"}>
                      <span className="sr-only">{d.kind === "removed" ? tv("code.removed") : tv("code.added")}: </span>
                      {d.kind === "removed" ? "− " : "+ "}
                      {d.text}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {powerNote && (
            <p className="text-sm font-medium" style={{ color: accent.ink }} role="status" data-testid="studio-code-power-note">
              {tv("code.powerWire")}
            </p>
          )}
          <CodeLines
            code={firmware.code}
            links={links}
            byId={byId}
            getPart={getPart}
            locale={ctx.locale}
            highlight={highlight}
            onShowInWiring={onShowInWiring}
            label={t("title_code")}
          />
          {wokwi?.ok && (
            <div className="space-y-1">
              <button type="button" className={linkCls} onClick={() => void downloadWokwi()} data-testid="studio-wokwi">
                <Download className="h-4 w-4" strokeWidth={1.75} aria-hidden />
                {tv("wokwi.download")}
              </button>
              <p className="ps-2 text-xs text-mutedtext">{tv("wokwi.guide")}</p>
              {wokwiFailed && <Problem>{tv("wokwi.failed")}</Problem>}
            </div>
          )}
          <span className="sr-only" aria-live="polite">
            {copied ? t("copied") : ""}
          </span>
        </>
      ) : state === "failed" ? (
        <Problem>{t("codeFailed")}</Problem>
      ) : (
        <div className="space-y-3" role="status" aria-busy="true" data-testid="studio-code-skeleton">
          <p className="text-sm font-medium" style={{ color: accent.ink }}>
            {t("codeWriting")}
          </p>
          <div className="space-y-2" aria-hidden>
            <Bar className="h-3.5 w-24" />
            {[0, 1, 2].map((i) => (
              <Bar key={i} className={i === 1 ? "h-3 w-1/2" : "h-3 w-2/3"} />
            ))}
          </div>
          <div aria-hidden dir="ltr" className="space-y-2 rounded-2xl bg-[#1c2434] p-4">
            {[70, 45, 0, 30, 55, 62, 40, 0, 35, 66, 50, 20].map((w, i) =>
              w === 0 ? (
                <span key={i} className="block h-2" />
              ) : (
                <span
                  key={i}
                  className="block h-2.5 rounded-full bg-white/10 motion-safe:animate-pulse"
                  style={{ width: `${w}%`, marginInlineStart: i % 4 === 1 || i % 4 === 2 ? "1.25rem" : undefined }}
                />
              ),
            )}
          </div>
        </div>
      )}
    </StepFrame>
  );
}
