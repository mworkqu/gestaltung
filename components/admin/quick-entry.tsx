"use client";

// Fast product entry (Task 17c/d/e).
//
// One at a time: pick images from Drive, then a compact keyboard-first form.
// Enter saves and reopens a blank form with category, class, supplier, lead
// time and "publish" kept from the previous entry; focus returns to Name.
// Alt+I opens the Drive picker from anywhere on the page.
//
// Bulk: pick many images, get a row per image named from its filename, fix
// names and prices in the grid, save the batch (Ctrl+Enter).
//
// Either way a very similar name in the same category comes back as a warning;
// saving again (Enter, or "save anyway" on the row) confirms it.

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Check, FolderOpen, Loader2, Save, Trash2, X } from "lucide-react";

import { saveQuickProducts, type QuickResult, type QuickRow } from "@/app/[locale]/dashboard/store/quick/actions";
import {
  drivePickerConfigured,
  importDriveFiles,
  nameFromFilename,
  pickDriveImages,
  type ImportedImage,
} from "@/lib/google/drive-picker";
import { ATTR_CLASSES, fieldsOf, isAttrClass, type Attributes } from "@/lib/store/attributes";
import type { Supplier } from "@/lib/store/sourcing";
import { cn } from "@/lib/utils";

const input =
  "w-full rounded-lg border border-white/60 bg-surface px-2.5 py-1.5 text-sm text-heading shadow-neu-inset outline-none focus:ring-2 focus:ring-cobalt/60";

type Sticky = { category: string; attrClass: string; supplierId: string; leadDays: string; publish: boolean };
type Dup = { id: string; sku: string; name: string }[];

function useDrive(t: ReturnType<typeof useTranslations>) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pick = useCallback(
    async (multiple: boolean): Promise<ImportedImage[]> => {
      setError(null);
      try {
        const picked = await pickDriveImages(multiple);
        if (!picked?.files.length) return [];
        setBusy(t("importing", { done: 0, total: picked.files.length }));
        const { images, failed } = await importDriveFiles(picked.files, picked.token, (done) =>
          setBusy(t("importing", { done, total: picked.files.length }))
        );
        if (failed.length) setError(t("importFailed", { names: failed.join(", ") }));
        return images;
      } catch (e) {
        setError(e instanceof Error && e.message === "not_configured" ? t("pickerNotConfigured") : t("pickerError"));
        return [];
      } finally {
        setBusy(null);
      }
    },
    [t]
  );
  return { pick, busy, error };
}

export function QuickEntry({
  locale,
  suppliers,
  categories,
  classByCategory,
}: {
  locale: string;
  suppliers: Supplier[];
  categories: string[];
  classByCategory: Record<string, string>;
}) {
  const t = useTranslations("QuickEntry");
  const [mode, setMode] = useState<"single" | "bulk">("single");
  const active = suppliers.filter((s) => s.active);
  const [sticky, setSticky] = useState<Sticky>({
    category: "",
    attrClass: "",
    supplierId: active[0]?.id ?? "",
    leadDays: "",
    publish: false,
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        {(["single", "bulk"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={cn(
              "rounded-full px-4 py-1.5 text-sm font-semibold",
              mode === m ? "bg-cobalt text-white" : "border border-borderstrong text-heading hover:border-cobalt"
            )}
          >
            {t(`mode_${m}`)}
          </button>
        ))}
        {!drivePickerConfigured && <span className="text-xs text-amber-700">{t("pickerNotConfigured")}</span>}
      </div>
      <datalist id="qe-categories">
        {categories.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      {mode === "single" ? (
        <SingleEntry locale={locale} suppliers={active} sticky={sticky} setSticky={setSticky} classByCategory={classByCategory} />
      ) : (
        <BulkEntry locale={locale} suppliers={active} sticky={sticky} setSticky={setSticky} />
      )}
    </div>
  );
}

function SingleEntry({
  locale,
  suppliers,
  sticky,
  setSticky,
  classByCategory,
}: {
  locale: string;
  suppliers: Supplier[];
  sticky: Sticky;
  setSticky: (s: Sticky) => void;
  classByCategory: Record<string, string>;
}) {
  const t = useTranslations("QuickEntry");
  const drive = useDrive(t);
  const nameRef = useRef<HTMLInputElement>(null);
  const [images, setImages] = useState<ImportedImage[]>([]);
  const [name, setName] = useState("");
  const [cost, setCost] = useState("");
  const [price, setPrice] = useState("");
  const [attrs, setAttrs] = useState<Attributes>({});
  const [dup, setDup] = useState<Dup | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ sku: string; name: string }[]>([]);
  const [pending, start] = useTransition();
  const supplier = suppliers.find((s) => s.id === sticky.supplierId);
  const cls = isAttrClass(sticky.attrClass) ? sticky.attrClass : null;

  const pickDrive = drive.pick;
  const pickImages = useCallback(async () => {
    const imgs = await pickDrive(true);
    if (imgs.length) {
      setImages((cur) => [...cur, ...imgs]);
      setName((cur) => cur || nameFromFilename(imgs[0].name));
      window.setTimeout(() => nameRef.current?.focus(), 0);
    }
  }, [pickDrive]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.key.toLowerCase() === "i") {
        e.preventDefault();
        void pickImages();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pickImages]);

  const onCategory = (v: string) => {
    const inferred = classByCategory[v];
    setSticky({ ...sticky, category: v, attrClass: inferred && inferred !== sticky.attrClass ? inferred : sticky.attrClass });
  };

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const row: QuickRow = {
      key: "one",
      name,
      category: sticky.category,
      attributes: cls ? { ...attrs, class: cls } : {},
      supplierId: sticky.supplierId,
      cost,
      price,
      leadDays: sticky.leadDays,
      images,
      publish: sticky.publish,
      confirmDuplicate: dup !== null,
    };
    start(async () => {
      const [r] = await saveQuickProducts(locale, [row]);
      if ("ok" in r) {
        setSaved((s) => [{ sku: r.sku, name }, ...s].slice(0, 30));
        setImages([]);
        setName("");
        setCost("");
        setPrice("");
        setAttrs({});
        setDup(null);
        setMsg(t("savedOne", { sku: r.sku }));
        nameRef.current?.focus();
      } else if ("duplicate" in r) {
        setDup(r.duplicate);
      } else setMsg(errorText(t, r.error));
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_16rem]">
      <form onSubmit={submit} className="neu space-y-4 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={pickImages}
            disabled={!!drive.busy}
            className="inline-flex items-center gap-2 rounded-full border border-borderstrong px-4 py-1.5 text-sm font-medium text-heading hover:border-cobalt hover:text-cobalt disabled:opacity-50"
          >
            {drive.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderOpen className="h-4 w-4" />}
            {drive.busy ?? t("pickImages")}
          </button>
          <span className="text-[11px] text-mutedtext">{t("pickHint")}</span>
        </div>
        {drive.error && <p className="text-xs text-destructive">{drive.error}</p>}
        {images.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {images.map((img, i) => (
              <div key={img.path} className="relative h-16 w-16 overflow-hidden rounded-lg bg-panel">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.thumb} alt="" className="h-full w-full object-cover" />
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={t("removeImage")}
                  onClick={() => setImages((cur) => cur.filter((_, j) => j !== i))}
                  className="absolute end-0.5 top-0.5 rounded-full bg-black/60 p-0.5 text-white"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <L label={t("name")} wide>
            <input
              ref={nameRef}
              autoFocus
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setDup(null);
              }}
              required
              className={input}
            />
          </L>
          <L label={t("category")}>
            <input value={sticky.category} onChange={(e) => onCategory(e.target.value)} list="qe-categories" required className={input} />
          </L>
          <L label={t("attrClass")}>
            <select value={sticky.attrClass} onChange={(e) => setSticky({ ...sticky, attrClass: e.target.value })} className={input}>
              <option value="">—</option>
              {ATTR_CLASSES.map((c) => (
                <option key={c} value={c}>
                  {c.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </L>
          {cls &&
            fieldsOf(cls).map((f) => (
              <L key={f.key} label={`${f.key.replace(/_/g, " ")}${f.unit ? ` (${f.unit})` : ""}`}>
                {f.options && f.type !== "list" ? (
                  <select value={String(attrs[f.key] ?? "")} onChange={(e) => setAttrs({ ...attrs, [f.key]: e.target.value })} className={input}>
                    <option value="">—</option>
                    {f.options.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input value={String(attrs[f.key] ?? "")} onChange={(e) => setAttrs({ ...attrs, [f.key]: e.target.value })} className={input} dir="ltr" />
                )}
              </L>
            ))}
          <L label={t("supplier")}>
            <select value={sticky.supplierId} onChange={(e) => setSticky({ ...sticky, supplierId: e.target.value })} className={input}>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </L>
          <L label={t("leadDays")}>
            <input value={sticky.leadDays} onChange={(e) => setSticky({ ...sticky, leadDays: e.target.value })} inputMode="numeric" className={input} dir="ltr" />
          </L>
          <L label={t("cost", { currency: supplier?.default_currency ?? "" })}>
            <input value={cost} onChange={(e) => setCost(e.target.value)} inputMode="decimal" className={input} dir="ltr" />
          </L>
          <L label={supplier?.default_pricing_mode === "mirror" ? t("priceMirror") : t("price")}>
            <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" required className={input} dir="ltr" />
          </L>
        </div>
        <label className="flex items-center gap-2 text-sm text-body">
          <input type="checkbox" checked={sticky.publish} onChange={(e) => setSticky({ ...sticky, publish: e.target.checked })} />
          {t("publish")}
        </label>

        {dup && (
          <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
            <p className="flex items-center gap-2 font-semibold">
              <AlertTriangle className="h-4 w-4" /> {t("dupTitle")}
            </p>
            <ul className="mt-1 list-disc ps-5">
              {dup.map((d) => (
                <li key={d.id}>
                  {d.name} <span className="font-mono text-xs">({d.sku})</span>
                </li>
              ))}
            </ul>
            <p className="mt-1 text-xs">{t("dupConfirm")}</p>
          </div>
        )}
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-full bg-cobalt px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {dup ? t("saveAnyway") : t("save")}
            <kbd className="ms-1 rounded bg-white/20 px-1 text-[10px]">Enter</kbd>
          </button>
          {msg && <span className="text-sm text-mutedtext">{msg}</span>}
        </div>
      </form>

      <aside className="neu h-fit p-4">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-mutedtext">{t("sessionLog", { count: saved.length })}</p>
        <ul className="mt-2 space-y-1 text-[12px]">
          {saved.map((s) => (
            <li key={s.sku} className="flex items-center gap-1.5 text-body">
              <Check className="h-3 w-3 shrink-0 text-emerald-600" />
              <span className="truncate">{s.name}</span>
              <span className="ms-auto font-mono text-[10px] text-faint">{s.sku}</span>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}

type BulkRow = {
  key: string;
  image: ImportedImage;
  name: string;
  category: string;
  supplierId: string;
  cost: string;
  price: string;
  leadDays: string;
  status?: { dup?: Dup; error?: string };
  confirm?: boolean;
};

function BulkEntry({
  locale,
  suppliers,
  sticky,
  setSticky,
}: {
  locale: string;
  suppliers: Supplier[];
  sticky: Sticky;
  setSticky: (s: Sticky) => void;
}) {
  const t = useTranslations("QuickEntry");
  const drive = useDrive(t);
  const [rows, setRows] = useState<BulkRow[]>([]);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  async function pick() {
    const imgs = await drive.pick(true);
    setRows((cur) => [
      ...cur,
      ...imgs.map((image) => ({
        key: image.path,
        image,
        name: nameFromFilename(image.name),
        category: sticky.category,
        supplierId: sticky.supplierId,
        cost: "",
        price: "",
        leadDays: sticky.leadDays,
      })),
    ]);
  }

  const set = (key: string, patch: Partial<BulkRow>) =>
    setRows((cur) => cur.map((r) => (r.key === key ? { ...r, ...patch, ...(patch.name !== undefined ? { status: undefined, confirm: false } : {}) } : r)));

  const applyAll = () =>
    setRows((cur) => cur.map((r) => ({ ...r, category: sticky.category, supplierId: sticky.supplierId, leadDays: sticky.leadDays })));

  const saveAll = useCallback(() => {
    if (!rows.length) return;
    setMsg(null);
    const payload: QuickRow[] = rows.map((r) => ({
      key: r.key,
      name: r.name,
      category: r.category,
      supplierId: r.supplierId,
      cost: r.cost,
      price: r.price,
      leadDays: r.leadDays,
      images: [{ web: r.image.web, thumb: r.image.thumb, path: r.image.path, drive_file_id: r.image.drive_file_id }],
      publish: sticky.publish,
      confirmDuplicate: r.confirm,
    }));
    start(async () => {
      const results = await saveQuickProducts(locale, payload);
      const byKey = new Map<string, QuickResult>(results.map((r) => [r.key, r]));
      const okCount = results.filter((r) => "ok" in r).length;
      setRows((cur) =>
        cur
          .filter((r) => !(byKey.get(r.key) && "ok" in byKey.get(r.key)!))
          .map((r) => {
            const res = byKey.get(r.key);
            if (!res) return r;
            if ("duplicate" in res) return { ...r, status: { dup: res.duplicate } };
            if ("error" in res) return { ...r, status: { error: res.error } };
            return r;
          })
      );
      setMsg(t("savedBatch", { count: okCount, left: results.length - okCount }));
    });
  }, [rows, sticky.publish, locale, t]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        saveAll();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saveAll]);

  const supplierOptions = useMemo(
    () =>
      suppliers.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      )),
    [suppliers]
  );

  return (
    <div className="space-y-4">
      <div className="neu flex flex-wrap items-end gap-3 p-4">
        <button
          type="button"
          onClick={pick}
          disabled={!!drive.busy}
          className="inline-flex items-center gap-2 rounded-full border border-borderstrong px-4 py-1.5 text-sm font-medium text-heading hover:border-cobalt hover:text-cobalt disabled:opacity-50"
        >
          {drive.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderOpen className="h-4 w-4" />}
          {drive.busy ?? t("pickMany")}
        </button>
        <L label={t("category")}>
          <input value={sticky.category} onChange={(e) => setSticky({ ...sticky, category: e.target.value })} list="qe-categories" className={input} />
        </L>
        <L label={t("supplier")}>
          <select value={sticky.supplierId} onChange={(e) => setSticky({ ...sticky, supplierId: e.target.value })} className={input}>
            {supplierOptions}
          </select>
        </L>
        <L label={t("leadDays")}>
          <input value={sticky.leadDays} onChange={(e) => setSticky({ ...sticky, leadDays: e.target.value })} className={cn(input, "w-20")} dir="ltr" />
        </L>
        <label className="flex items-center gap-2 pb-2 text-sm text-body">
          <input type="checkbox" checked={sticky.publish} onChange={(e) => setSticky({ ...sticky, publish: e.target.checked })} />
          {t("publish")}
        </label>
        {rows.length > 0 && (
          <button type="button" onClick={applyAll} className="pb-2 text-xs font-medium text-cobalt hover:underline">
            {t("applyAll")}
          </button>
        )}
      </div>
      {drive.error && <p className="text-xs text-destructive">{drive.error}</p>}

      {rows.length > 0 && (
        <div className="neu overflow-x-auto p-3">
          <table className="w-full min-w-[900px] border-collapse text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-mutedtext">
                {["", "name", "category", "supplier", "costShort", "price", "leadDays", ""].map((k, i) => (
                  <th key={i} className="px-1.5 py-2 text-start font-semibold">
                    {k ? t(k, { currency: "" }) : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-t border-borderstrong/40 align-top">
                  <td className="px-1.5 py-1.5">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={r.image.thumb} alt="" className="h-12 w-12 rounded-md object-cover" />
                  </td>
                  <td className="px-1.5 py-1.5">
                    <input value={r.name} onChange={(e) => set(r.key, { name: e.target.value })} className={input} />
                    {r.status?.dup && (
                      <div className="mt-1 text-[11px] text-amber-800">
                        <span className="font-semibold">{t("dupShort")}</span> {r.status.dup.map((d) => `${d.name} (${d.sku})`).join(", ")}
                        <label className="ms-2 inline-flex items-center gap-1">
                          <input type="checkbox" checked={!!r.confirm} onChange={(e) => set(r.key, { confirm: e.target.checked })} />
                          {t("saveAnyway")}
                        </label>
                      </div>
                    )}
                    {r.status?.error && <p className="mt-1 text-[11px] text-destructive">{errorText(t, r.status.error)}</p>}
                  </td>
                  <td className="px-1.5 py-1.5">
                    <input value={r.category} onChange={(e) => set(r.key, { category: e.target.value })} list="qe-categories" className={input} />
                  </td>
                  <td className="px-1.5 py-1.5">
                    <select value={r.supplierId} onChange={(e) => set(r.key, { supplierId: e.target.value })} className={input}>
                      {supplierOptions}
                    </select>
                  </td>
                  <td className="px-1.5 py-1.5">
                    <input value={r.cost} onChange={(e) => set(r.key, { cost: e.target.value })} inputMode="decimal" className={cn(input, "w-24")} dir="ltr" />
                  </td>
                  <td className="px-1.5 py-1.5">
                    <input value={r.price} onChange={(e) => set(r.key, { price: e.target.value })} inputMode="decimal" className={cn(input, "w-24")} dir="ltr" />
                  </td>
                  <td className="px-1.5 py-1.5">
                    <input value={r.leadDays} onChange={(e) => set(r.key, { leadDays: e.target.value })} inputMode="numeric" className={cn(input, "w-16")} dir="ltr" />
                  </td>
                  <td className="px-1.5 py-1.5">
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label={t("removeRow")}
                      onClick={() => setRows((cur) => cur.filter((x) => x.key !== r.key))}
                      className="p-1 text-mutedtext hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={saveAll}
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-full bg-cobalt px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {t("saveBatch", { count: rows.length })}
              <kbd className="ms-1 rounded bg-white/20 px-1 text-[10px]">Ctrl+Enter</kbd>
            </button>
          </div>
        </div>
      )}
      {msg && <p className="text-sm text-mutedtext">{msg}</p>}
    </div>
  );
}

const KNOWN_ERRORS = ["required", "supplier", "price", "sku"] as const;
function errorText(t: ReturnType<typeof useTranslations>, e: string) {
  return (KNOWN_ERRORS as readonly string[]).includes(e) ? t(`error_${e}`) : e;
}

function L({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <label className={cn("block space-y-1", wide && "sm:col-span-2")}>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-mutedtext">{label}</span>
      {children}
    </label>
  );
}
