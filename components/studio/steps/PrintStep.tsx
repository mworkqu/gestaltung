"use client";

// Step 5 · Print parts (P5-14). The small printed parts that hold everything
// in place, plus the case itself (lid + base):
//  * on entry with an enclosure and no doc.mech → POST /api/studio/mech (free);
//    any failure falls back to the same deterministic list in the browser
//    (defaultMechParts), so the step always has parts;
//  * the browser builds them in the Studio geometry worker (lib/studio/geometry,
//    loaded on demand, cached and shared with the Enclosure step's case). The 3D
//    view with "Take it apart" lives in the Enclosure step (W6: everything 3D in
//    one step); this step is the printable-parts list, grams and STL downloads;
//  * the list says what each part is in plain words, its material and grams
//    (a stake pod's soil spike is its own row);
//  * main button "Next". Asking us to make it is the Studio's one "Get it
//    made" bar (W2, components/studio/GetItMade.tsx), not a button here.

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import type * as THREE from "three";
import {
  BatteryMedium,
  Box,
  Cable,
  CircleDot,
  Cylinder,
  Download,
  Frame,
  Layers,
  Lightbulb,
  PanelTop,
  Radar,
} from "lucide-react";

import { defaultMechParts, layoutBounds, mechSummary } from "@/lib/studio/ai/mech-default";
import { downloadBlob } from "@/lib/studio/download";
import { layoutComponents, layoutResultOf } from "@/lib/studio/layout";
import { useStudioLibrary } from "../StudioLibraryProvider";
import type { BuiltMechPart } from "@/lib/studio/mech/build";
import { STEP_ACCENT } from "@/lib/studio/palette";
import type { MechPart, MechTemplate, PrintedList, StudioDoc } from "@/lib/studio/schema";
import { printedGramsOf } from "@/lib/studio/weight";
import { printNote } from "@/lib/studio/print-notes";
import { platePlan } from "@/lib/studio/geometry/mesh-check";
import { fileSlug } from "@/lib/studio/client/steps";
import type { StudioCtx } from "../studio-ctx";
import type { UnlockedProduct } from "../use-product";
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
  /** F-003: false when any body in the row failed the manifold check. */
  printable: boolean;
  parts: BuiltMechPart[];
};

/**
 * F-027: the row key carries the SIZE, so two battery clips cut for different
 * cells (49.6 mm and 24.0 mm) are two rows and never one line reading "x 2".
 */
function rowKey(b: BuiltMechPart): string {
  const size = `${Math.round(b.size.w * 10)}x${Math.round(b.size.d * 10)}x${Math.round(b.size.h * 10)}`;
  return `${b.template}:${b.printable.material}:${b.name.en}:${size}`;
}

function rowsOf(built: BuiltMechPart[]): Row[] {
  const rows = new Map<string, Row>();
  for (const b of built) {
    // (The stake pod's spike is a "base"-template part with its own name: its own row.)
    const key = rowKey(b);
    const row = rows.get(key);
    if (row) {
      row.count += 1;
      row.grams += b.printable.estGrams;
      row.printable = row.printable && b.check.ok;
      row.parts.push(b);
    } else {
      rows.set(key, {
        key,
        template: b.template,
        name: b.name,
        material: b.printable.material,
        count: 1,
        grams: b.printable.estGrams,
        printable: b.check.ok,
        parts: [b],
      });
    }
  }
  const rank = (r: Row) => (FIRST.includes(r.template) ? FIRST.indexOf(r.template) : FIRST.length);
  return [...rows.values()].sort((a, b) => rank(a) - rank(b));
}

/** The printed list as BUILT, stored on the doc so the quote reads the same grams (F-004). */
export function printedListOf(rows: readonly Row[], plates: number): PrintedList {
  const list = rows.map((r) => ({
    key: r.key,
    name: r.name,
    material: r.material,
    count: r.count,
    grams: Math.round(r.grams),
    printable: r.printable,
  }));
  return { source: "template", rows: list, grams: printedGramsOf(list.filter((r) => r.printable)), plates };
}

// P5-16: an unlocked product prints its own bodies (PrintProduct.tsx, its own chunk).
const PrintProduct = dynamic(() => import("./PrintProduct").then((m) => m.PrintProduct));

export function PrintStep({
  ctx,
  doc,
  unlocked,
  beforeServer,
  onMech,
  onPrinted,
  onNext,
}: {
  ctx: StudioCtx;
  doc: StudioDoc;
  unlocked: UnlockedProduct;
  beforeServer: () => Promise<void>;
  onMech: (mech: MechPart[], serverVersion: number | null) => void;
  onPrinted: (printed: PrintedList) => void;
  onNext: () => void;
}) {
  if (doc.product?.unlockedId) return <PrintProduct ctx={ctx} doc={doc} unlocked={unlocked} onPrinted={onPrinted} onNext={onNext} />;
  return <PrintTemplate ctx={ctx} doc={doc} beforeServer={beforeServer} onMech={onMech} onPrinted={onPrinted} onNext={onNext} />;
}

function PrintTemplate({
  ctx,
  doc,
  beforeServer,
  onMech,
  onPrinted,
  onNext,
}: {
  ctx: StudioCtx;
  doc: StudioDoc;
  beforeServer: () => Promise<void>;
  onMech: (mech: MechPart[], serverVersion: number | null) => void;
  onPrinted: (printed: PrintedList) => void;
  onNext: () => void;
}) {
  const { getPart } = useStudioLibrary();
  const t = useTranslations("Studio");
  const { locale } = ctx;

  const placed = useMemo(
    () =>
      doc.components.flatMap((c) => {
        const part = getPart(c.partId);
        return part ? [{ c, part }] : [];
      }),
    [doc.components, getPart],
  );
  const layout = useMemo(
    () =>
      layoutComponents(
        placed.map(({ c, part }) => ({ instanceId: c.instanceId, part })),
        { clearance: doc.enclosure?.clearance, sizeHint: doc.spec.sizeHint },
      ),
    [placed, doc.enclosure?.clearance, doc.spec.sizeHint],
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
        // Off the main thread; the case is the viewer's own cached build (same key).
        const { getEnclosureGeometry, getMechGeometry, mechObjects } = await import("@/lib/studio/geometry/client");
        const parts = new Map(placed.map(({ c, part }) => [c.instanceId, part]));
        const lr = layoutResultOf(layout.layout, parts);
        const [enc, mech] = await Promise.all([
          getEnclosureGeometry(enclosure, lr, parts),
          getMechGeometry(enclosure, lr, parts, doc.mech, doc.spec.environment),
        ]);
        const list = mechObjects(mech, enc);
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
      // Geometry belongs to the geometry cache; only the per-part materials are ours.
      for (const b of built ?? []) {
        const mesh = b.object as THREE.Mesh;
        if (!mesh.userData.shell) (mesh.material as THREE.Material | undefined)?.dispose();
      }
    },
    [built],
  );

  const rows = useMemo(() => rowsOf(built ?? []), [built]);
  // F-003: only closed bodies are weighed and offered.
  const printableRows = rows.filter((r) => r.printable);
  const total = Math.round(printedGramsOf(printableRows));
  const unclosed = rows.filter((r) => !r.printable);
  const plateItems = useMemo(
    () => (built ?? []).filter((b) => b.check.ok).map((b) => ({ w: b.size.w, d: b.size.d, h: b.size.h })),
    [built],
  );
  const plan = useMemo(() => platePlan(plateItems), [plateItems]);

  // F-004: the grams the Print step BUILT are stored on the doc, so the Request
  // page and the quote estimate read this list instead of their own guess.
  const printedKey = JSON.stringify(printedListOf(rows, plan.plates.length));
  useEffect(() => {
    if (!built?.length) return;
    const next = JSON.parse(printedKey) as PrintedList;
    if (JSON.stringify(doc.printed) === printedKey) return;
    onPrinted(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the built list
  }, [printedKey, built]);

  // ── Downloads ────────────────────────────────────────────────────────────
  const slug = fileSlug(ctx.projectName);
  const fileName = (b: BuiltMechPart) => `${slug}-${b.id}.stl`;
  // The STL writer (three.js exporter) loads on first use.
  async function downloadAll() {
    const closed = (built ?? []).filter((b) => b.check.ok);
    if (!closed.length) return;
    const { platesSTL } = await import("@/lib/studio/export");
    const out = platesSTL(closed.map((b) => b.object));
    out.plates.forEach((pl, i) => {
      const suffix = out.plates.length > 1 ? `-plate-${i + 1}` : "";
      downloadBlob(`${slug}-print-parts${suffix}.stl`, pl.data, "model/stl");
    });
  }
  async function downloadRow(row: Row) {
    if (!row.printable) return;
    const { printableSTL } = await import("@/lib/studio/export");
    for (const b of row.parts) downloadBlob(fileName(b), printableSTL(b.object), "model/stl");
  }

  const ready = !!built && built.length > 0;
  const anyFile = printableRows.length > 0;
  const loading = !ready && !buildFailed && (fetching || doc.mech.length > 0 || !!doc.enclosure);

  return (
    <StepFrame
      step="print"
      n={ctx.n("print")}
      title={t("title_print")}
      headline={t("headline_print")}
      intro={t("intro_print")}
      footer={<MainButton onClick={onNext}>{t("next")}</MainButton>}
      secondary={
        <button type="button" className={linkCls} onClick={() => void downloadAll()} disabled={!ready || !anyFile}>
          <Download className="h-4 w-4" strokeWidth={1.75} aria-hidden />
          {t("downloadAllStl")}
        </button>
      }
    >
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
                        {r.printable
                          ? `${t(`material_${r.material}`)} · ${t("grams", { g: String(Math.round(r.grams)) })}`
                          : printNote("unclosed", locale)}
                      </span>
                    </span>
                    {r.printable && (
                      <button
                        type="button"
                        onClick={() => void downloadRow(r)}
                        aria-label={t("downloadPartStl", { name })}
                        title={t("downloadPartStl", { name })}
                        className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-cobalt hover:bg-white"
                      >
                        <Download className="h-4 w-4" strokeWidth={1.75} aria-hidden />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
            {anyFile && (
              <p className="text-sm font-semibold" style={{ color: accent.ink }} data-testid="studio-print-total">
                {t("printTotal", { g: String(total) })}
              </p>
            )}
            {plan.plates.length > 1 && (
              <p className="text-xs text-mutedtext" data-testid="studio-print-plates">
                {printNote("plates", locale, { n: plan.plates.length })}
              </p>
            )}
            {plan.tooBig.length > 0 && <Problem>{printNote("tooBig", locale)}</Problem>}
            {unclosed.length > 0 && (
              <Problem>
                {printNote("unclosed", locale)} {printNote("unclosedParts", locale)}{" "}
                {unclosed.map((r) => r.name[locale]).join(", ")}
              </Problem>
            )}
            {/* F-042: this step gives STL only; the editable STEP comes with the engineer quote. */}
            <p className="text-xs text-mutedtext" data-testid="studio-print-step-format">
              {printNote("stepFormat", locale)}
            </p>
          </>
        )}
      </div>

    </StepFrame>
  );
}
