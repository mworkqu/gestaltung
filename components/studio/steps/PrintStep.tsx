"use client";

// Step 5 · Print parts (P5-14). The small printed parts that hold everything
// in place, plus the case itself (lid + base):
//  * on entry with an enclosure and no doc.mech → POST /api/studio/mech (free);
//    any failure falls back to the same deterministic list in the browser
//    (defaultMechParts), so the step always has parts;
//  * the browser builds them (lib/studio/mech/build.ts, loaded on demand with
//    the enclosure CSG) and the viewer shows case + components + every part,
//    with a "Take it apart" slider (the viewer eases it; reduced motion jumps);
//  * the list says what each part is in plain words, its material and grams;
//  * main button "Request printing from Gestaltung360": the STLs go to the
//    visitor's own folder of the private cad-files bucket, then one lead
//    (/api/store-lead source print_request). Quantity is always 1. The
//    WhatsApp number is asked only when the profile has none (PhonePrompt).

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type * as THREE from "three";
import {
  BatteryMedium,
  Box,
  Cable,
  CheckCircle2,
  CircleDot,
  Cylinder,
  Download,
  Frame,
  Layers,
  Lightbulb,
  Loader2,
  PanelTop,
  Printer,
  Radar,
} from "lucide-react";

import { PhonePrompt } from "@/components/projects/phone-prompt";
import { StudioViewer } from "@/components/studio/viewer/ViewerLazy";
import type { ViewerExtraObject } from "@/components/studio/viewer/types";
import { defaultMechParts, layoutBounds, mechSummary } from "@/lib/studio/ai/mech-default";
import { downloadBlob, plateSTL, printableSTL } from "@/lib/studio/export";
import { layoutComponents } from "@/lib/studio/layout";
import { getPart } from "@/lib/studio/library";
import type { BuiltMechPart } from "@/lib/studio/mech/build";
import { STEP_ACCENT } from "@/lib/studio/palette";
import type { MechPart, MechTemplate, StudioDoc } from "@/lib/studio/schema";
import { fileSlug } from "@/lib/studio/client/steps";
import type { Profile } from "@/lib/studio/client/api";
import type { StudioCtx } from "../StudioShell";
import { Bar, linkCls, MainButton, Problem, StepFrame } from "../ui";

const accent = STEP_ACCENT.print;

const ICONS: Record<MechTemplate, typeof Box> = {
  standoff: Cylinder,
  pcb_cradle: Layers,
  battery_clip: BatteryMedium,
  sensor_mount: Radar,
  cable_clip: Cable,
  button_extender: CircleDot,
  light_pipe: Lightbulb,
  wall_bracket: Frame,
  lid: PanelTop,
  base: Box,
};

/** The case first (lid, base), then the small parts in the order the list gave them. */
const FIRST: MechTemplate[] = ["lid", "base"];

type Row = {
  key: string;
  template: MechTemplate;
  name: { en: string; ar: string };
  material: BuiltMechPart["printable"]["material"];
  count: number;
  grams: number;
  parts: BuiltMechPart[];
};

function rowsOf(built: BuiltMechPart[]): Row[] {
  const rows = new Map<string, Row>();
  for (const b of built) {
    const key = `${b.template}:${b.printable.material}`;
    const row = rows.get(key);
    if (row) {
      row.count += 1;
      row.grams += b.printable.estGrams;
      row.parts.push(b);
    } else {
      rows.set(key, { key, template: b.template, name: b.name, material: b.printable.material, count: 1, grams: b.printable.estGrams, parts: [b] });
    }
  }
  const rank = (r: Row) => (FIRST.includes(r.template) ? FIRST.indexOf(r.template) : FIRST.length);
  return [...rows.values()].sort((a, b) => rank(a) - rank(b));
}

export function PrintStep({
  ctx,
  doc,
  beforeServer,
  onMech,
  onNext,
}: {
  ctx: StudioCtx;
  doc: StudioDoc;
  beforeServer: () => Promise<void>;
  onMech: (mech: MechPart[], serverVersion: number | null) => void;
  onNext: () => void;
}) {
  const t = useTranslations("Studio");
  const { locale } = ctx;

  const placed = useMemo(
    () =>
      doc.components.flatMap((c) => {
        const part = getPart(c.partId);
        return part ? [{ c, part }] : [];
      }),
    [doc.components],
  );
  const layout = useMemo(
    () =>
      layoutComponents(
        placed.map(({ c, part }) => ({ instanceId: c.instanceId, part })),
        { clearance: doc.enclosure?.clearance, sizeHint: doc.spec.sizeHint },
      ),
    [placed, doc.enclosure?.clearance, doc.spec.sizeHint],
  );
  const viewerComponents = useMemo(
    () => placed.map(({ c }) => ({ instanceId: c.instanceId, partId: c.partId, label: c.label })),
    [placed],
  );

  // ── The parts list (server, else the same rules in the browser) ──────────
  const started = useRef(false);
  const [fetching, setFetching] = useState(false);
  useEffect(() => {
    if (!doc.enclosure || doc.mech.length > 0 || started.current) return;
    started.current = true;
    let alive = true;
    setFetching(true);
    void (async () => {
      await beforeServer();
      const r = await ctx.api.mech(doc, null);
      if (!alive) return;
      if (r.ok && r.data.mech.length) onMech(r.data.mech, r.data.docVersion);
      else {
        const items = doc.layout.length ? doc.layout : layout.layout;
        const b = layoutBounds(doc.components, items, getPart);
        const pad = 2 * ((doc.enclosure?.wall ?? 2) + (doc.enclosure?.clearance ?? 2));
        const summary = mechSummary({
          components: doc.components,
          layout: items,
          getPart,
          enclosure: b ? { w: b.w + pad, d: b.d + pad, h: b.h + pad } : { w: 60, d: 40, h: 25 },
          template: doc.enclosure?.template,
        });
        onMech(defaultMechParts(summary), null);
      }
      setFetching(false);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per visit
  }, [doc.enclosure, doc.mech.length]);

  // ── Build the printable parts (three + CSG, loaded on demand) ────────────
  const encKey = doc.enclosure ? JSON.stringify({ ...doc.enclosure, colour: undefined, finish: undefined, accentColour: undefined }) : "";
  const mechKey = JSON.stringify(doc.mech);
  const [built, setBuilt] = useState<BuiltMechPart[] | null>(null);
  const [buildFailed, setBuildFailed] = useState(false);
  useEffect(() => {
    const enclosure = doc.enclosure;
    if (!enclosure || doc.mech.length === 0 || placed.length === 0) {
      setBuilt(null);
      return;
    }
    let alive = true;
    void (async () => {
      try {
        const [{ buildEnclosure }, { buildMechParts }] = await Promise.all([
          import("@/lib/studio/enclosure/build"),
          import("@/lib/studio/mech/build"),
        ]);
        const parts = new Map(placed.map(({ c, part }) => [c.instanceId, part]));
        const enc = buildEnclosure(enclosure, layout, parts);
        // Standoffs fill floor → board underside where the parts stand in THIS case.
        const list = buildMechParts(doc.mech, { ...layout, layout: enc.meta.layout }, parts, { base: enc.base, lid: enc.lid, dims: enc.meta.dims }, {
          environment: doc.spec.environment,
        });
        if (alive) {
          setBuilt(list);
          setBuildFailed(false);
        }
      } catch (err) {
        console.warn("[studio print] build failed", err);
        if (alive) setBuildFailed(true);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the shape, not on colour
  }, [encKey, mechKey, layout, placed]);
  useEffect(
    () => () => {
      for (const b of built ?? []) (b.object as THREE.Mesh).geometry?.dispose();
    },
    [built],
  );

  const extraObjects = useMemo<ViewerExtraObject[]>(
    () =>
      (built ?? [])
        .filter((b) => b.template !== "lid" && b.template !== "base")
        .map((b) => ({ name: b.id, object: b.object, explode: b.explode })),
    [built],
  );
  const rows = useMemo(() => rowsOf(built ?? []), [built]);
  const total = rows.reduce((g, r) => g + r.grams, 0);
  const [explode, setExplode] = useState(0);

  // ── Downloads ────────────────────────────────────────────────────────────
  const slug = fileSlug(ctx.projectName);
  const fileName = (b: BuiltMechPart) => `${slug}-${b.id}.stl`;
  function downloadAll() {
    if (!built?.length) return;
    downloadBlob(`${slug}-print-parts.stl`, plateSTL(built.map((b) => b.object)), "model/stl");
  }
  function downloadRow(row: Row) {
    for (const b of row.parts) downloadBlob(fileName(b), printableSTL(b.object), "model/stl");
  }

  // ── Request printing ─────────────────────────────────────────────────────
  const [req, setReq] = useState<"idle" | "checking" | "phone" | "sending" | "sent" | "failed">("idle");
  const [profile, setProfile] = useState<Profile | null>(null);

  async function send(p: Profile, phone: string) {
    if (!built?.length) return;
    setReq("sending");
    const files = built.map((b) => ({ name: fileName(b), data: printableSTL(b.object) }));
    const paths = await ctx.api.uploadPrintFiles(files).catch(() => [] as string[]);
    const ok = await ctx.api.requestPrint({
      name: p.fullName || t("defaultContactName"),
      phone,
      locale,
      designName: doc.spec.name,
      parts: rows.map((r) => ({ name: r.count > 1 ? `${r.name.en} × ${r.count}` : r.name.en, material: r.material, grams: r.grams })),
      totalGrams: total,
      files: paths,
    });
    setReq(ok ? "sent" : "failed");
  }

  async function requestPrint() {
    setReq("checking");
    const p = await ctx.api.profile();
    setProfile(p);
    if (p.phone) await send(p, p.phone);
    else if (p.userId) setReq("phone");
    else setReq("failed");
  }

  const busy = req === "checking" || req === "sending";
  const ready = !!built && built.length > 0;
  const loading = !ready && !buildFailed && (fetching || doc.mech.length > 0 || !!doc.enclosure);

  if (req === "sent") {
    return (
      <StepFrame
        step="print"
        n={ctx.n("print")}
        title={t("title_print")}
        headline={t("requestReceived")}
        intro={t("printReceivedText")}
        footer={<MainButton onClick={onNext}>{t("next")}</MainButton>}
      >
        <div
          className="tile flex items-center gap-3 border-0 p-5 motion-safe:animate-rise"
          style={{ background: accent.soft }}
          role="status"
          data-testid="studio-print-received"
        >
          <CheckCircle2 className="h-8 w-8 shrink-0" style={{ color: accent.ink }} strokeWidth={1.5} aria-hidden />
          <p className="text-base font-semibold text-heading">{t("printReceivedText")}</p>
        </div>
      </StepFrame>
    );
  }

  return (
    <StepFrame
      step="print"
      n={ctx.n("print")}
      title={t("title_print")}
      headline={t("headline_print")}
      intro={t("intro_print")}
      footer={
        <MainButton onClick={() => void requestPrint()} disabled={!ready || busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Printer className="h-4 w-4" strokeWidth={1.75} aria-hidden />}
          {busy ? t("requestPrintSending") : t("requestPrint")}
        </MainButton>
      }
      secondary={
        <>
          <button type="button" className={linkCls} onClick={downloadAll} disabled={!ready}>
            <Download className="h-4 w-4" strokeWidth={1.75} aria-hidden />
            {t("downloadAllStl")}
          </button>
          <button type="button" className={linkCls} onClick={onNext}>
            {t("skipToCode")}
          </button>
        </>
      }
    >
      <div className="relative h-[320px] overflow-hidden rounded-[24px] shadow-neu-inset sm:h-[420px]" data-testid="studio-print-viewer">
        <StudioViewer
          components={viewerComponents}
          layout={layout.layout}
          enclosure={doc.enclosure}
          extraObjects={extraObjects}
          explode={explode}
          accent={accent.base}
          autoRotate
          ariaLabel={t("viewerPrint")}
        />
      </div>

      <label className="flex min-h-11 items-center gap-3" data-testid="studio-explode">
        <span className="shrink-0 text-sm font-bold text-heading">{t("takeApart")}</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={explode}
          onChange={(e) => setExplode(Number(e.target.value))}
          disabled={!ready}
          className="h-11 w-full cursor-pointer"
          style={{ accentColor: accent.ink }}
        />
      </label>

      <div className="space-y-3">
        <h2 className="text-sm font-bold text-heading">{t("printListTitle")}</h2>
        {!ready ? (
          loading ? (
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
          ) : (
            <Problem>{t("loadFailed")}</Problem>
          )
        ) : (
          <>
            <ul className="space-y-2" data-testid="studio-print-list">
              {rows.map((r) => {
                const Icon = ICONS[r.template];
                const name = r.name[locale];
                return (
                  <li key={r.key} className="tile flex items-center gap-3 p-3">
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl" style={{ background: accent.soft }}>
                      <Icon className="h-5 w-5" style={{ color: accent.ink }} strokeWidth={1.75} aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold text-heading">
                        {name}
                        {r.count > 1 && (
                          <span className="ms-1.5 font-semibold text-mutedtext">
                            <bdi dir="ltr">× {r.count}</bdi>
                          </span>
                        )}
                      </span>
                      <span className="block text-xs text-mutedtext">
                        {t(`material_${r.material}`)} · {t("grams", { g: String(r.grams) })}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => downloadRow(r)}
                      aria-label={t("downloadPartStl", { name })}
                      title={t("downloadPartStl", { name })}
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
      </div>

      {req === "phone" && profile?.userId && (
        <PhonePrompt
          userId={profile.userId}
          variant="quote"
          onSaved={(phone) => void send(profile, phone)}
          onDismiss={() => setReq("idle")}
        />
      )}
      {req === "failed" && <Problem>{t("requestFailed")}</Problem>}
    </StepFrame>
  );
}
