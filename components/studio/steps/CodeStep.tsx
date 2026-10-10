"use client";

// Step 6 · Your code (P5-14). Real starter firmware for the board the visitor
// chose: on entry with wiring and no doc.firmware → POST /api/studio/firmware
// (free, like /api/firmware; the pins come from OUR wiring). Shows the board,
// a short plain list of steps (when the server sent them), the code in a
// left-to-right monospace block that scrolls sideways, and "Copy code" as the
// secondary action; the main button stays "Next". No wiring yet → "Draw your
// wiring first" with a way back.

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Code2, Copy, RefreshCw } from "lucide-react";

import { useStudioLibrary } from "../StudioLibraryProvider";
import { STEP_ACCENT } from "@/lib/studio/palette";
import type { StudioDoc } from "@/lib/studio/schema";
import type { StudioFirmware } from "@/lib/studio/client/api";
import type { StudioCtx } from "../StudioShell";
import { Bar, linkCls, MainButton, Problem, StepFrame } from "../ui";

const accent = STEP_ACCENT.code;

export function CodeStep({
  ctx,
  doc,
  beforeServer,
  onFirmware,
  onNext,
  onWiring,
}: {
  ctx: StudioCtx;
  doc: StudioDoc;
  beforeServer: () => Promise<void>;
  onFirmware: (firmware: { board: string; code: string }, serverVersion: number | null) => void;
  onNext: () => void;
  /** Go back to the Wiring step. */
  onWiring: () => void;
}) {
  const { getPart } = useStudioLibrary();
  const t = useTranslations("Studio");
  const mcu = doc.components.map((c) => getPart(c.partId)).find((p) => p?.category === "mcu");
  const wired = doc.netlist.nets.length > 0 && doc.checks.length > 0;
  const firmware = doc.firmware ?? null;

  const [extra, setExtra] = useState<Pick<StudioFirmware, "steps" | "libraries"> | null>(null);
  const [state, setState] = useState<"idle" | "writing" | "failed">("idle");
  const [copied, setCopied] = useState(false);
  const started = useRef(false);

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
          <pre
            dir="ltr"
            data-testid="studio-code"
            aria-label={t("title_code")}
            tabIndex={0}
            className="max-h-[420px] overflow-auto rounded-2xl bg-[#1c2434] p-4 text-start font-mono text-xs leading-relaxed text-[#e7ecf3]"
          >
            <code>{firmware.code}</code>
          </pre>
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
