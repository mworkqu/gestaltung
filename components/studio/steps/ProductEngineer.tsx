"use client";

// Engineer view of the product designs (P5-16, super_admin only): per design the
// vision score, loops, what the check thought it looks like / is missing, the
// solver's issues and the ProductModel JSON (GET /api/studio/product/engineer).
// Rendered only when ctx.isAdmin; loads on first open. Never shown to clients.
// Opening it also fetches the 3D engine (super_admin may open any design's CAD).

import { useState } from "react";
import { useTranslations } from "next-intl";

import { preloadProductViewer } from "@/components/studio/viewer/ProductViewerLazy";
import type { EngineerDesign } from "@/lib/studio/client/api";
import type { StudioDoc } from "@/lib/studio/schema";
import type { StudioCtx } from "../studio-ctx";

export function ProductEngineer({ ctx, doc }: { ctx: StudioCtx; doc: StudioDoc }) {
  const t = useTranslations("Studio");
  const [state, setState] = useState<{ status: "idle" | "loading" | "ready" | "failed"; designs: EngineerDesign[] }>({ status: "idle", designs: [] });

  async function load() {
    const api = ctx.api.product;
    if (!api || state.status === "loading") return;
    setState({ status: "loading", designs: [] });
    const r = await api.engineer(doc);
    setState(r.ok ? { status: "ready", designs: r.data.designs } : { status: "failed", designs: [] });
  }

  return (
    <details
      className="tile space-y-3 p-4 text-sm"
      data-testid="studio-product-engineer"
      onToggle={(e) => {
        if (!(e.currentTarget as HTMLDetailsElement).open) return;
        preloadProductViewer();
        if (state.status === "idle") void load();
      }}
    >
      <summary className="min-h-11 cursor-pointer content-center font-bold text-heading">{t("product.engineerTitle")}</summary>
      {state.status === "loading" && <p className="text-mutedtext">{t("loading")}</p>}
      {state.status === "failed" && <p className="text-destructive">{t("failed")}</p>}
      {state.status === "ready" && state.designs.length === 0 && <p className="text-mutedtext">{t("product.engineerNone")}</p>}
      {state.designs.map((d) => (
        <div key={d.id} className="space-y-1.5 border-t border-black/5 pt-3" data-testid="studio-product-engineer-design">
          <p className="font-bold text-heading">
            <bdi dir="ltr">{d.id}</bdi>
            {doc.product?.chosenId === d.id ? ` · ${t("product.engineerChosen")}` : ""}
            {doc.product?.unlockedId === d.id ? ` · ${t("product.engineerUnlocked")}` : ""}
          </p>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
            <dt className="text-mutedtext">{t("product.engineerScore")}</dt>
            <dd dir="ltr" className="text-start">{d.score ?? "—"}</dd>
            <dt className="text-mutedtext">{t("product.engineerLoops")}</dt>
            <dd dir="ltr" className="text-start">{d.loops ?? "—"}</dd>
            <dt className="text-mutedtext">{t("product.engineerLooksLike")}</dt>
            <dd dir="ltr" className="text-start">{d.looksLike || "—"}</dd>
            <dt className="text-mutedtext">{t("product.engineerMissing")}</dt>
            <dd dir="ltr" className="text-start">{d.missing?.length ? d.missing.join(", ") : "—"}</dd>
            <dt className="text-mutedtext">{t("product.engineerSource")}</dt>
            <dd dir="ltr" className="text-start">{d.source ?? "—"}</dd>
          </dl>
          <details>
            <summary className="min-h-11 cursor-pointer content-center text-xs font-semibold text-cobalt">
              {t("product.engineerIssues")} ({d.issues?.length ?? 0})
            </summary>
            <pre dir="ltr" className="max-h-64 overflow-auto rounded-xl bg-white/70 p-3 text-start text-[11px] leading-snug">{JSON.stringify(d.issues ?? [], null, 2)}</pre>
          </details>
          <details>
            <summary className="min-h-11 cursor-pointer content-center text-xs font-semibold text-cobalt">{t("product.engineerModel")}</summary>
            <pre dir="ltr" className="max-h-80 overflow-auto rounded-xl bg-white/70 p-3 text-start text-[11px] leading-snug">{JSON.stringify(d.model ?? null, null, 2)}</pre>
          </details>
        </div>
      ))}
    </details>
  );
}
