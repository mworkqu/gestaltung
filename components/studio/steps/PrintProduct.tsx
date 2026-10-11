"use client";

// Step 5 · Print parts for the real product (P5-16 Phase 2b): one row per printed
// body (head, stake, tank, light ring… and the halves of a split shell) with its
// material, grams and its own STL, plus one file with every part on a plate.
// The STLs are cut in the geometry worker from the product it built after
// "Create my CAD" (print pose, on the bed). Bought parts (metal probe tips) are
// not printed. "Get it made" (W2) sends all of them.

import { useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Box, Download, Droplet, Lightbulb, Pin, SquareStack } from "lucide-react";

import { downloadBlob } from "@/lib/studio/download";
import { fileSlug } from "@/lib/studio/client/steps";
import { productStls, type ProductStlResult } from "@/lib/studio/client/product";
import { STEP_ACCENT } from "@/lib/studio/palette";
import type { StudioCtx } from "../StudioShell";
import type { UnlockedProduct } from "../use-product";
import { Bar, linkCls, MainButton, Problem, StepFrame } from "../ui";

const accent = STEP_ACCENT.print;

const ICON: Record<string, typeof Box> = { stake: Pin, reservoir: Droplet, light_ring: Lightbulb, window: Lightbulb, lid: SquareStack, cover: SquareStack };

export function PrintProduct({ ctx, unlocked, onNext }: { ctx: StudioCtx; unlocked: UnlockedProduct; onNext: () => void }) {
  const t = useTranslations("Studio");
  const data = unlocked.data;
  const slug = fileSlug(ctx.projectName);
  const stl = useRef<Promise<ProductStlResult> | null>(null);
  const [failed, setFailed] = useState(false);

  const rows = useMemo(
    () =>
      (data?.pieces ?? [])
        .filter((p) => p.printable)
        .map((p) => ({ id: p.id, role: p.role, piece: p.piece, material: p.material, grams: Math.max(1, Math.round(p.grams)) })),
    [data],
  );
  const total = rows.reduce((g, r) => g + r.grams, 0);

  function files(): Promise<ProductStlResult> {
    if (!data) return Promise.reject(new Error("not ready"));
    stl.current ??= productStls(data.hash, slug).catch((err: unknown) => {
      stl.current = null;
      throw err;
    });
    return stl.current;
  }

  async function downloadOne(id: string) {
    try {
      const r = await files();
      const f = r.files.find((x) => x.id === id);
      if (f) downloadBlob(f.name, f.data, "model/stl");
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }
  async function downloadAll() {
    try {
      const r = await files();
      if (r.combined) downloadBlob(r.combined.name, r.combined.data, "model/stl");
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }

  const name = (r: (typeof rows)[number]) =>
    r.piece === "whole" ? t(`product.role_${r.role}`) : `${t(`product.role_${r.role}`)} · ${t(`product.piece_${r.piece}`)}`;
  const materialName = (m: string) => t(`material_${m}`);

  return (
    <StepFrame
      step="print"
      n={ctx.n("print")}
      title={t("title_print")}
      headline={t("product.printHeadline")}
      intro={t("product.printIntro")}
      footer={<MainButton onClick={onNext}>{t("next")}</MainButton>}
      secondary={
        <button type="button" className={linkCls} onClick={() => void downloadAll()} disabled={!rows.length} data-testid="studio-product-stl-all">
          <Download className="h-4 w-4" strokeWidth={1.75} aria-hidden />
          {t("downloadAllStl")}
        </button>
      }
    >
      <div className="space-y-3">
        <h2 className="text-sm font-bold text-heading">{t("printListTitle")}</h2>
        {!data ? (
          unlocked.status === "failed" ? (
            <Problem>{t("loadFailed")}</Problem>
          ) : (
            <div className="space-y-2" aria-busy="true" role="status">
              <span className="sr-only">{t("printLoading")}</span>
              {[0, 1, 2].map((i) => (
                <div key={i} className="tile flex items-center gap-3 p-3">
                  <Bar className="h-11 w-11 rounded-2xl" />
                  <span className="flex-1 space-y-2">
                    <Bar className="h-3 w-1/2" />
                    <Bar className="h-3 w-1/3" />
                  </span>
                </div>
              ))}
            </div>
          )
        ) : (
          <>
            <ul className="space-y-2" data-testid="studio-print-list" data-kind="product">
              {rows.map((r) => {
                const Icon = ICON[r.role] ?? Box;
                const label = name(r);
                return (
                  <li key={r.id} className="tile flex items-center gap-3 p-3" data-testid="studio-product-stl" data-piece={r.id} data-role={r.role}>
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl" style={{ background: accent.soft }}>
                      <Icon className="h-5 w-5" style={{ color: accent.ink }} strokeWidth={1.75} aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold text-heading">{label}</span>
                      <span className="block text-xs text-mutedtext">
                        {materialName(r.material)} · {t("grams", { g: String(r.grams) })}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => void downloadOne(r.id)}
                      aria-label={t("downloadPartStl", { name: label })}
                      title={t("downloadPartStl", { name: label })}
                      className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-cobalt hover:bg-white"
                    >
                      <Download className="h-4 w-4" strokeWidth={1.75} aria-hidden />
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="text-sm font-semibold" style={{ color: accent.ink }} data-testid="studio-print-total">
              {t("printTotal", { g: String(total) })}
            </p>
          </>
        )}
        {failed && <Problem>{t("failed")}</Problem>}
      </div>
    </StepFrame>
  );
}
