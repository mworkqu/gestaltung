"use client";

// Step 5 · Your code. Phase 1: a friendly card — the starter code is prepared
// when the visitor orders. TODO(P5-13 Phase 2): connect firmware here
// (doc.firmware {board, code}, generated from doc.netlist like
// lib/prototyping/firmware.ts) and show / download it.

import { useTranslations } from "next-intl";
import { Code2 } from "lucide-react";

import { getPart } from "@/lib/studio/library";
import { STEP_ACCENT } from "@/lib/studio/palette";
import type { StudioDoc } from "@/lib/studio/schema";
import type { StudioCtx } from "../StudioShell";
import { MainButton, StepFrame } from "../ui";

const accent = STEP_ACCENT.code;

export function CodeStep({ ctx, doc, onNext }: { ctx: StudioCtx; doc: StudioDoc; onNext: () => void }) {
  const t = useTranslations("Studio");
  const board = doc.components.map((c) => getPart(c.partId)).find((p) => p?.category === "mcu");
  return (
    <StepFrame
      step="code"
      n={ctx.n("code")}
      title={t("title_code")}
      headline={t("headline_code")}
      intro={t("intro_code")}
      footer={<MainButton onClick={onNext}>{t("next")}</MainButton>}
    >
      <div className="tile flex items-start gap-4 border-0 p-5" style={{ background: `linear-gradient(135deg, ${accent.soft}, #eef2f7 75%)` }}>
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-surface shadow-neu-sm">
          <Code2 className="h-6 w-6" style={{ color: accent.ink }} strokeWidth={1.5} aria-hidden />
        </span>
        <div className="space-y-1">
          <p className="text-base font-bold text-heading">{t("codeCard")}</p>
          {board && <p className="text-sm text-body">{t("codeBoard", { board: board.name[ctx.locale] })}</p>}
        </div>
      </div>
    </StepFrame>
  );
}
