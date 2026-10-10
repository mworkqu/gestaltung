"use client";

// Studio library part form (P5-15c): add a part or edit one (a code part is
// pre-filled from code). Save → savePart(): the same checks the Studio runs
// (field parsing, LibraryPartSchema, validatePart; STL parts skip the model
// size check but need dims). Errors show under their fields in plain words;
// the deeper checks show as a list. Optional 3D preview through the Studio
// viewer (plate mode) with this one part. STL files upload straight from the
// browser to the public studio-models bucket (super admin write, 0070).

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Box, Loader2, Plus, Save, Trash2, Upload } from "lucide-react";

import { Link, useRouter } from "@/i18n/navigation";
import { savePart } from "@/app/[locale]/dashboard/studio-library/actions";
import { StudioViewer } from "@/components/studio/viewer/ViewerLazy";
import { withOverrides } from "@/components/studio/StudioLibraryProvider";
import { createClient } from "@/lib/supabase/client";
import { setClientLibrary } from "@/lib/studio/library";
import { draftToPart, type FieldError, type PartDraft } from "@/lib/studio/library/form";
import { CATEGORIES, FACES, LOOKS, PIN_ROLES, PIN_SIDES, PORT_KINDS, type LibraryPart } from "@/lib/studio/schema";
import { SkuField } from "./sku-check";

const STL_BUCKET = "studio-models";
const STL_MAX_BYTES = 20 * 1024 * 1024;

const input =
  "w-full rounded-lg border border-white/60 bg-surface px-3 py-2 text-sm text-heading shadow-neu-inset outline-none focus:ring-2 focus:ring-cobalt/60 disabled:opacity-60";
const invalid = "ring-2 ring-destructive/60";
const small = "min-h-11 md:min-h-9";

type Props = {
  locale: string;
  initial: PartDraft;
  /** null = a new part (id editable). */
  originalId: string | null;
  builders: string[];
  readOnly: boolean;
};

export function StudioPartForm({ locale, initial, originalId, builders, readOnly }: Props) {
  const t = useTranslations("StudioLibrary");
  const router = useRouter();
  const [d, setD] = useState<PartDraft>(initial);
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const [checks, setChecks] = useState<string[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [preview, setPreview] = useState<{ part: LibraryPart; key: string } | null>(null);
  const [upload, setUpload] = useState<{ state: "idle" | "busy" | "failed" | "too_big"; size?: [number, number, number] }>({ state: "idle" });

  // Leaving the form: the module-level library goes back to normal.
  useEffect(() => () => setClientLibrary(null), []);

  const patch = <K extends keyof PartDraft>(k: K, v: PartDraft[K]) => {
    setD((x) => ({ ...x, [k]: v }));
    setMsg(null);
  };
  const errOf = (field: string) => fieldErrors.find((e) => e.field === field);
  const errText = (field: string) => {
    const e = errOf(field);
    return e ? t(`err_${e.code}`) : null;
  };

  const save = () =>
    start(async () => {
      const local = draftToPart(d);
      if (!local.ok) {
        setFieldErrors(local.errors);
        setChecks([]);
        setMsg({ ok: false, text: t("fixErrors") });
        return;
      }
      const r = await savePart(locale, d, originalId);
      if (r.ok) {
        setFieldErrors([]);
        setChecks([]);
        setMsg({ ok: true, text: t("saved") });
        if (!originalId) router.replace(`/dashboard/studio-library/${r.id}`);
        else router.refresh();
        return;
      }
      setFieldErrors(r.fieldErrors ?? []);
      setChecks(r.checks ?? []);
      setMsg({
        ok: false,
        text:
          r.message === "run_0070" ? t("needsMigration") : r.message === "forbidden" ? t("forbidden") : r.fieldErrors?.length || r.checks?.length ? t("fixErrors") : t("failed"),
      });
    });

  const showPreview = () => {
    const r = draftToPart(d);
    if (!r.ok) {
      setFieldErrors(r.errors);
      setMsg({ ok: false, text: t("fixErrors") });
      return;
    }
    setClientLibrary(withOverrides([r.part]));
    setPreview({ part: r.part, key: JSON.stringify(r.part) });
  };

  async function onStl(file: File) {
    if (file.size > STL_MAX_BYTES) {
      setUpload({ state: "too_big" });
      return;
    }
    setUpload({ state: "busy" });
    try {
      // Size from the file (mm), offered as the part's dims.
      let size: [number, number, number] | undefined;
      try {
        const { STLLoader } = await import("three/examples/jsm/loaders/STLLoader.js");
        const geo = new STLLoader().parse(await file.arrayBuffer());
        geo.computeBoundingBox();
        const b = geo.boundingBox;
        if (b) size = [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z].map((n) => Math.round(n * 10) / 10) as [number, number, number];
        geo.dispose();
      } catch {
        size = undefined;
      }
      const supabase = createClient();
      const path = `${(d.id.trim() || "part").replace(/[^a-z0-9_]/g, "_")}/${Date.now()}.stl`;
      const { error } = await supabase.storage.from(STL_BUCKET).upload(path, file, { contentType: "model/stl", upsert: false });
      if (error) throw error;
      const { data } = supabase.storage.from(STL_BUCKET).getPublicUrl(path);
      setD((x) => ({ ...x, modelKind: "stl", stlUrl: data.publicUrl }));
      setUpload({ state: "idle", size });
    } catch (e) {
      console.warn("[studio-library] STL upload failed:", e instanceof Error ? e.message : e);
      setUpload({ state: "failed" });
    }
  }

  const text = (field: keyof PartDraft & string, label: string, opts: { ltr?: boolean; area?: boolean; disabled?: boolean; hint?: string } = {}) => {
    const e = errText(field);
    const id = `sp-${field}`;
    const common = {
      id,
      value: d[field] as string,
      disabled: readOnly || opts.disabled,
      dir: opts.ltr ? ("ltr" as const) : undefined,
      "aria-invalid": e ? true : undefined,
      className: `${input} ${e ? invalid : ""}`,
    };
    return (
      <div className="min-w-0 space-y-1">
        <label htmlFor={id} className="block text-xs font-medium text-body">
          {label}
        </label>
        {opts.area ? (
          <textarea {...common} rows={3} onChange={(ev) => patch(field, ev.target.value as never)} />
        ) : (
          <input {...common} onChange={(ev) => patch(field, ev.target.value as never)} />
        )}
        {opts.hint && <p className="text-xs text-mutedtext">{opts.hint}</p>}
        {e && <p className="text-sm text-destructive">{e}</p>}
      </div>
    );
  };

  const select = (field: keyof PartDraft & string, label: string, values: readonly string[], labelOf: (v: string) => string = (v) => v) => {
    const e = errText(field);
    const id = `sp-${field}`;
    return (
      <div className="min-w-0 space-y-1">
        <label htmlFor={id} className="block text-xs font-medium text-body">
          {label}
        </label>
        <select
          id={id}
          value={d[field] as string}
          disabled={readOnly}
          onChange={(ev) => patch(field, ev.target.value as never)}
          className={`${input} ${e ? invalid : ""}`}
        >
          {values.map((v) => (
            <option key={v} value={v}>
              {labelOf(v)}
            </option>
          ))}
        </select>
        {e && <p className="text-sm text-destructive">{e}</p>}
      </div>
    );
  };

  /** One cell of a repeating row (holes / ports / pins). */
  const cell = (
    field: string,
    label: string,
    value: string,
    onChange: (v: string) => void,
    values?: readonly string[],
  ) => {
    const e = errText(field);
    const id = `sp-${field}`;
    return (
      <div className="min-w-0 space-y-1">
        <label htmlFor={id} className="block text-[11px] font-medium text-body">
          {label}
        </label>
        {values ? (
          <select id={id} value={value} disabled={readOnly} onChange={(ev) => onChange(ev.target.value)} className={`${input} px-2 ${e ? invalid : ""}`}>
            {values.map((v) => (
              <option key={v} value={v}>
                {v || "—"}
              </option>
            ))}
          </select>
        ) : (
          <input id={id} value={value} disabled={readOnly} dir="ltr" onChange={(ev) => onChange(ev.target.value)} className={`${input} px-2 ${e ? invalid : ""}`} />
        )}
        {e && <p className="text-xs text-destructive">{e}</p>}
      </div>
    );
  };

  const listPatch = <K extends "holes" | "ports" | "pins">(k: K, i: number, key: keyof PartDraft[K][number], v: string) =>
    setD((x) => ({ ...x, [k]: (x[k] as PartDraft[K]).map((r, j) => (j === i ? { ...r, [key]: v } : r)) }));
  const listRemove = (k: "holes" | "ports" | "pins", i: number) => setD((x) => ({ ...x, [k]: (x[k] as unknown[]).filter((_, j) => j !== i) }));

  const removeBtn = (k: "holes" | "ports" | "pins", i: number) =>
    !readOnly && (
      <button type="button" onClick={() => listRemove(k, i)} aria-label={t("removeRow")} className={`inline-flex items-center self-end px-2 text-mutedtext hover:text-destructive ${small}`}>
        <Trash2 className="h-4 w-4" aria-hidden />
      </button>
    );
  const addBtn = (label: string, onClick: () => void) =>
    !readOnly && (
      <button type="button" onClick={onClick} className={`inline-flex items-center gap-1.5 text-sm font-semibold text-cobalt hover:text-cobalt-hover ${small}`}>
        <Plus className="h-4 w-4" aria-hidden />
        {label}
      </button>
    );

  return (
    <div className="space-y-5">
      {readOnly && <p className="neu p-4 text-sm font-semibold text-amber-800">{t("needsMigration")}</p>}

      <section className="neu space-y-4 p-6">
        <h2 className="text-lg font-bold text-heading">{t("sectionBasics")}</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {text("id", t("fieldId"), { ltr: true, disabled: !!originalId, hint: t("fieldIdHint") })}
          {select("category", t("fieldCategory"), CATEGORIES, (v) => t(`cat_${v}`))}
          {text("nameEn", t("fieldNameEn"))}
          {text("nameAr", t("fieldNameAr"))}
          {text("blurbEn", t("fieldBlurbEn"), { area: true })}
          {text("blurbAr", t("fieldBlurbAr"), { area: true })}
          {text("tags", t("fieldTags"), { ltr: true, hint: t("fieldTagsHint") })}
          <div className="min-w-0 space-y-1">
            <label htmlFor="sp-storeSkus" className="block text-xs font-medium text-body">
              {t("fieldSkus")}
            </label>
            <SkuField id="sp-storeSkus" value={d.storeSkus} onChange={(v) => patch("storeSkus", v)} disabled={readOnly} />
            <p className="text-xs text-mutedtext">{t("fieldSkusHint")}</p>
          </div>
        </div>
        <label className="inline-flex min-h-11 items-center gap-2 text-sm text-body">
          <input type="checkbox" checked={d.helper} disabled={readOnly} onChange={(e) => patch("helper", e.target.checked)} className="h-4 w-4 accent-cobalt" />
          {t("fieldHelper")}
        </label>
      </section>

      <section className="neu space-y-4 p-6">
        <h2 className="text-lg font-bold text-heading">{t("sectionShape")}</h2>
        <p className="text-xs text-mutedtext">{t("sectionShapeHint")}</p>
        <div className="grid grid-cols-3 gap-3">
          {text("dimX", t("fieldDimX"), { ltr: true })}
          {text("dimY", t("fieldDimY"), { ltr: true })}
          {text("dimZ", t("fieldDimZ"), { ltr: true })}
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {select("lookBody", t("fieldLook"), LOOKS, (v) => t(`look_${v}`))}
          {text("lookAccent", t("fieldAccent"), { ltr: true, hint: t("fieldAccentHint") })}
          {text("clearance", t("fieldClearance"), { ltr: true, hint: t("fieldClearanceHint") })}
        </div>

        <div className="space-y-2">
          <label className="inline-flex min-h-11 items-center gap-2 text-sm text-body">
            <input type="checkbox" checked={d.hasMount} disabled={readOnly} onChange={(e) => patch("hasMount", e.target.checked)} className="h-4 w-4 accent-cobalt" />
            {t("fieldHasMount")}
          </label>
          {d.hasMount && (
            <div className="tile space-y-2">
              <div className="max-w-xs">{text("standoffHeight", t("fieldStandoff"), { ltr: true })}</div>
              <p className="text-xs text-mutedtext">{t("holesHint")}</p>
              {d.holes.map((h, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2">
                  {cell(`holes.${i}.x`, "x", h.x, (v) => listPatch("holes", i, "x", v))}
                  {cell(`holes.${i}.y`, "y", h.y, (v) => listPatch("holes", i, "y", v))}
                  {cell(`holes.${i}.d`, t("holeD"), h.d, (v) => listPatch("holes", i, "d", v))}
                  {removeBtn("holes", i)}
                </div>
              ))}
              {addBtn(t("addHole"), () => setD((x) => ({ ...x, holes: [...x.holes, { x: "", y: "", d: "3" }] })))}
            </div>
          )}
        </div>
      </section>

      <section className="neu space-y-3 p-6">
        <h2 className="text-lg font-bold text-heading">{t("sectionPorts")}</h2>
        <p className="text-xs text-mutedtext">{t("portsHint")}</p>
        {d.ports.map((p, i) => (
          <div key={i} className="tile grid grid-cols-2 gap-2 sm:grid-cols-[1.4fr_0.8fr_repeat(4,minmax(0,1fr))_auto]">
            {cell(`ports.${i}.kind`, t("portKind"), p.kind, (v) => listPatch("ports", i, "kind", v), PORT_KINDS)}
            {cell(`ports.${i}.face`, t("portFace"), p.face, (v) => listPatch("ports", i, "face", v), FACES)}
            {cell(`ports.${i}.u`, "u (0–1)", p.u, (v) => listPatch("ports", i, "u", v))}
            {cell(`ports.${i}.v`, "v (0–1)", p.v, (v) => listPatch("ports", i, "v", v))}
            {cell(`ports.${i}.w`, t("portW"), p.w, (v) => listPatch("ports", i, "w", v))}
            {cell(`ports.${i}.h`, t("portH"), p.h, (v) => listPatch("ports", i, "h", v))}
            {removeBtn("ports", i)}
          </div>
        ))}
        {addBtn(t("addPort"), () => setD((x) => ({ ...x, ports: [...x.ports, { kind: "usb_c", face: "-y", u: "0.5", v: "0.5", w: "9", h: "3.5" }] })))}
      </section>

      <section className="neu space-y-3 p-6">
        <h2 className="text-lg font-bold text-heading">{t("sectionPins")}</h2>
        <p className="text-xs text-mutedtext">{t("pinsHint")}</p>
        {d.pins.map((p, i) => (
          <div key={i} className="tile grid grid-cols-2 gap-2 sm:grid-cols-[repeat(5,minmax(0,1fr))_auto]">
            {cell(`pins.${i}.id`, t("pinId"), p.id, (v) => listPatch("pins", i, "id", v))}
            {cell(`pins.${i}.label`, t("pinLabel"), p.label, (v) => listPatch("pins", i, "label", v))}
            {cell(`pins.${i}.role`, t("pinRole"), p.role, (v) => listPatch("pins", i, "role", v), PIN_ROLES)}
            {cell(`pins.${i}.voltage`, t("pinVoltage"), p.voltage, (v) => listPatch("pins", i, "voltage", v))}
            {cell(`pins.${i}.side`, t("pinSide"), p.side, (v) => listPatch("pins", i, "side", v), ["", ...PIN_SIDES])}
            {removeBtn("pins", i)}
          </div>
        ))}
        {addBtn(t("addPin"), () => setD((x) => ({ ...x, pins: [...x.pins, { id: "", label: "", role: "gpio", voltage: "", side: "" }] })))}
      </section>

      <section className="neu space-y-4 p-6">
        <h2 className="text-lg font-bold text-heading">{t("sectionPower")}</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {text("vMin", t("fieldVMin"), { ltr: true })}
          {text("vMax", t("fieldVMax"), { ltr: true })}
          {select("logicV", t("fieldLogicV"), ["3.3", "5"], (v) => `${v} V`)}
          {text("mA", t("fieldMa"), { ltr: true })}
        </div>
      </section>

      <section className="neu space-y-4 p-6">
        <h2 className="text-lg font-bold text-heading">{t("sectionModel")}</h2>
        <div className="flex flex-wrap gap-4">
          {(["procedural", "stl"] as const).map((k) => (
            <label key={k} className="inline-flex min-h-11 items-center gap-2 text-sm text-body">
              <input type="radio" name="modelKind" checked={d.modelKind === k} disabled={readOnly} onChange={() => patch("modelKind", k)} className="h-4 w-4 accent-cobalt" />
              {t(`model_${k}`)}
            </label>
          ))}
        </div>
        {d.modelKind === "procedural" ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {select("builder", t("fieldBuilder"), builders.includes(d.builder) ? builders : [d.builder, ...builders])}
            {text("params", t("fieldParams"), { ltr: true, area: true, hint: t("fieldParamsHint") })}
          </div>
        ) : (
          <div className="space-y-3">
            {!readOnly && (
              <label className={`inline-flex cursor-pointer items-center gap-2 rounded-full bg-cobalt px-4 text-sm font-semibold text-white hover:bg-cobalt-hover ${small}`}>
                {upload.state === "busy" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Upload className="h-4 w-4" aria-hidden />}
                {t("uploadStl")}
                <input
                  type="file"
                  accept=".stl,model/stl,application/sla,application/octet-stream"
                  className="sr-only"
                  disabled={upload.state === "busy"}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void onStl(f);
                    e.target.value = "";
                  }}
                />
              </label>
            )}
            {upload.state === "failed" && <p className="text-sm text-destructive">{t("uploadFailed")}</p>}
            {upload.state === "too_big" && <p className="text-sm text-destructive">{t("uploadTooBig")}</p>}
            {upload.size && (
              <p className="flex flex-wrap items-center gap-2 text-sm text-body">
                {t("stlSize", { x: String(upload.size[0]), y: String(upload.size[1]), z: String(upload.size[2]) })}
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => {
                      const s = upload.size!;
                      setD((x) => ({ ...x, dimX: String(s[0]), dimY: String(s[1]), dimZ: String(s[2]) }));
                    }}
                    className="font-semibold text-cobalt hover:text-cobalt-hover"
                  >
                    {t("useStlSize")}
                  </button>
                )}
              </p>
            )}
            {text("stlUrl", t("fieldStlUrl"), { ltr: true, hint: t("fieldStlUrlHint") })}
          </div>
        )}
      </section>

      <section className="neu space-y-3 p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-bold text-heading">{t("sectionPreview")}</h2>
          <button type="button" onClick={showPreview} className={`inline-flex items-center gap-1.5 text-sm font-semibold text-cobalt hover:text-cobalt-hover ${small}`}>
            <Box className="h-4 w-4" aria-hidden />
            {preview ? t("refreshPreview") : t("showPreview")}
          </button>
        </div>
        {preview ? (
          <div className="h-72 overflow-hidden rounded-2xl">
            <StudioViewer
              key={preview.key}
              components={[{ instanceId: "preview", partId: preview.part.id, label: preview.part.name.en }]}
              ariaLabel={t("previewAria", { name: preview.part.name[locale === "ar" ? "ar" : "en"] })}
              autoRotate
            />
          </div>
        ) : (
          <p className="text-xs text-mutedtext">{t("previewHint")}</p>
        )}
        {preview?.part.model.kind === "stl" && <p className="text-xs text-mutedtext">{t("previewStlNote")}</p>}
      </section>

      {checks.length > 0 && (
        <div className="neu space-y-2 p-6" role="alert">
          <p className="text-sm font-bold text-destructive">{t("checksTitle")}</p>
          <ul className="list-disc space-y-1 ps-5 text-sm text-destructive">
            {checks.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {!readOnly && (
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className="inline-flex min-h-11 items-center gap-2 rounded-full bg-cobalt px-5 text-sm font-semibold text-white hover:bg-cobalt-hover disabled:opacity-50"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
            {t("savePart")}
          </button>
        )}
        <Link href="/dashboard/studio-library" className="inline-flex min-h-11 items-center text-sm font-medium text-mutedtext hover:text-heading">
          {t("backToList")}
        </Link>
        {msg && (
          <p className={`text-sm ${msg.ok ? "text-emerald-700" : "text-destructive"}`} role={msg.ok ? "status" : "alert"}>
            {msg.text}
          </p>
        )}
      </div>
    </div>
  );
}
