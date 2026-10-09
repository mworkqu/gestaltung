"use client";

// Seasonal campaigns (P3-07, store_settings.occasions from migration 0056).
// The owner edits the list here: id, titles, dates, the store search or an
// explicit SKU list, and a banner line in both languages. Save validates with
// the same schema the storefront reads (lib/occasions.ts) in a super_admin
// server action, upserts the row and calls revalidateStorefront(); errors come
// back per row and field.

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { saveOccasions } from "@/app/[locale]/dashboard/store/occasions/actions";
import {
  BANNER_MAX,
  draftsToInput,
  emptyDraft,
  isOccasionActive,
  OCCASIONS_MAX,
  qatarToday,
  validateOccasions,
  type OccasionDraft,
  type OccasionError,
} from "@/lib/occasions";

const input =
  "w-full rounded-lg border border-white/60 bg-surface px-3 py-2 text-sm text-heading shadow-neu-inset outline-none focus:ring-2 focus:ring-cobalt/60";
const invalid = "ring-2 ring-destructive/60";

type Row = { key: number; draft: OccasionDraft };

export function OccasionsEditor({ locale, initial }: { locale: string; initial: OccasionDraft[] }) {
  const t = useTranslations("Occasions");
  const router = useRouter();
  const nextKey = useRef(initial.length);
  const [rows, setRows] = useState<Row[]>(() => initial.map((draft, key) => ({ key, draft })));
  const [errors, setErrors] = useState<OccasionError[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const today = qatarToday();

  const patch = (key: number, name: keyof OccasionDraft, value: string) => {
    setRows((all) => all.map((r) => (r.key === key ? { ...r, draft: { ...r.draft, [name]: value } } : r)));
    setMsg(null);
  };
  const add = () => {
    nextKey.current += 1;
    const key = nextKey.current;
    setRows((all) => [...all, { key, draft: emptyDraft() }]);
    setMsg(null);
  };
  const remove = (key: number) => {
    setRows((all) => all.filter((r) => r.key !== key));
    setErrors([]);
    setMsg(null);
  };

  const rowCodes = (index: number) => errors.filter((e) => e.index === index).map((e) => e.code);

  const save = () =>
    start(async () => {
      const drafts = rows.map((r) => r.draft);
      // Same schema as the server: show the problems without a round trip.
      const local = validateOccasions(draftsToInput(drafts));
      if (!local.ok) {
        setErrors(local.errors);
        setMsg(t("adminFixErrors"));
        return;
      }
      const r = await saveOccasions(locale, drafts);
      if (!r.ok) {
        setErrors(r.errors);
        setMsg(r.errors.length ? t("adminFixErrors") : r.message === "forbidden" ? t("adminForbidden") : t("adminFailed"));
        return;
      }
      setErrors([]);
      setMsg(t("adminSaved", { count: r.count }));
      router.refresh();
    });

  const field = (
    row: Row,
    index: number,
    name: keyof OccasionDraft,
    label: string,
    opts: { ltr?: boolean; placeholder?: string; max?: number; hint?: string } = {},
  ) => {
    const bad = rowCodes(index).includes(name);
    const id = `occ-${row.key}-${name}`;
    return (
      <div className="min-w-0 space-y-1">
        <label htmlFor={id} className="block text-xs font-medium text-body">
          {label}
        </label>
        <input
          id={id}
          value={row.draft[name]}
          onChange={(e) => patch(row.key, name, e.target.value)}
          dir={opts.ltr ? "ltr" : undefined}
          placeholder={opts.placeholder}
          maxLength={opts.max}
          aria-invalid={bad || undefined}
          className={`${input} ${bad ? invalid : ""}`}
        />
        {opts.hint && <p className="text-xs text-mutedtext">{opts.hint}</p>}
      </div>
    );
  };

  return (
    <div className="neu space-y-4 p-6">
      <div>
        <h2 className="text-lg font-bold text-heading">{t("adminTitle")}</h2>
        <p className="mt-1 max-w-3xl text-xs text-mutedtext">{t("adminHelp")}</p>
      </div>

      {rows.length === 0 && <p className="text-sm text-mutedtext">{t("adminEmpty")}</p>}

      <div className="space-y-4">
        {rows.map((row, index) => {
          const d = row.draft;
          const codes = rowCodes(index);
          const on = isOccasionActive(d, today);
          const rowName = d.title_en.trim() || t("adminRow", { n: index + 1 });
          return (
            <fieldset key={row.key} className="tile min-w-0 space-y-3">
              <legend className="sr-only">{rowName}</legend>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-heading">
                  {rowName}
                  {on && (
                    <span className="ms-2 rounded-full bg-cobalt px-2 py-0.5 text-xs font-semibold text-white">{t("onNow")}</span>
                  )}
                </p>
                <div className="flex items-center gap-3">
                  {/^[a-z0-9][a-z0-9-]*$/.test(d.id) && (
                    <Link
                      href={`/store/collections/${d.id}`}
                      className="inline-flex items-center text-sm font-medium text-cobalt hover:text-cobalt-hover max-md:min-h-11"
                    >
                      {t("adminViewPage")}
                    </Link>
                  )}
                  <button
                    type="button"
                    onClick={() => remove(row.key)}
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-mutedtext hover:text-destructive max-md:min-h-11"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                    {t("adminRemove")}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                {field(row, index, "id", t("fieldId"), { ltr: true, placeholder: "science-fair", max: 48 })}
                {field(row, index, "start", t("fieldStart"), { ltr: true, placeholder: "02-01  /  2027-02-08", max: 10 })}
                {field(row, index, "end", t("fieldEnd"), { ltr: true, placeholder: "03-31  /  2027-03-12", max: 10 })}
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {field(row, index, "title_en", t("fieldTitleEn"), { max: 80 })}
                {field(row, index, "title_ar", t("fieldTitleAr"), { max: 80 })}
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {field(row, index, "query", t("fieldQuery"), { max: 100, hint: t("fieldQueryHint") })}
                {field(row, index, "skus", t("fieldSkus"), { ltr: true, placeholder: "VLT-123, VLT-456", hint: t("fieldSkusHint") })}
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {field(row, index, "banner_en", t("fieldBannerEn"), {
                  max: BANNER_MAX,
                  hint: t("fieldBannerCount", { n: d.banner_en.length, max: BANNER_MAX }),
                })}
                {field(row, index, "banner_ar", t("fieldBannerAr"), {
                  max: BANNER_MAX,
                  hint: t("fieldBannerCount", { n: d.banner_ar.length, max: BANNER_MAX }),
                })}
              </div>

              {codes.length > 0 && (
                <ul className="space-y-0.5 text-sm text-destructive" role="alert">
                  {codes.map((code) => (
                    <li key={code}>{t(`err_${code}`)}</li>
                  ))}
                </ul>
              )}
            </fieldset>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={add}
          disabled={rows.length >= OCCASIONS_MAX}
          className="inline-flex items-center gap-1.5 rounded-full border border-borderstrong px-3 py-1.5 text-sm font-medium text-heading hover:border-cobalt hover:text-cobalt disabled:opacity-50 max-md:min-h-11"
        >
          <Plus className="h-4 w-4" aria-hidden />
          {t("adminAdd")}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={save}
          className="inline-flex items-center gap-1.5 rounded-full bg-cobalt px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50 max-md:min-h-11"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
          {t("adminSave")}
        </button>
        {msg && (
          <span className="text-sm text-mutedtext" aria-live="polite">
            {msg}
          </span>
        )}
      </div>
    </div>
  );
}
