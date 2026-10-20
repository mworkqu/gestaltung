"use client";

// School prices (store_settings.school_pricing): the four numbers a teacher is
// quoted on /schools and on their class page — team pack, class pack, the school
// 3D-print rule and whether Economy delivery is QAR 0 on a class order. Save
// validates with the same schema the public read uses (lib/schools/pricing.ts)
// in a super_admin server action, upserts the row and calls
// revalidateStorefront(); errors come back per field.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, Save } from "lucide-react";

import { saveSchoolPricing } from "@/app/[locale]/dashboard/store/schools/actions";
import { formatQar } from "@/lib/pricing/plans";
import { perCreditQar, validateSchoolPricing, type SchoolPricing, type SchoolPricingError } from "@/lib/schools/pricing";

const input =
  "w-full rounded-lg border border-white/60 bg-surface px-3 py-2 text-sm text-heading shadow-neu-inset outline-none focus:ring-2 focus:ring-cobalt/60";
const invalid = "ring-2 ring-destructive/60";

/** The form's own state: numbers are typed, so they live as strings until save. */
type Draft = {
  teamCredits: string;
  teamQar: string;
  classCredits: string;
  classQar: string;
  baseQar: string;
  perGram: string;
  freeDelivery: boolean;
};

function toDraft(p: SchoolPricing): Draft {
  return {
    teamCredits: String(p.team_pack.credits),
    teamQar: String(p.team_pack.qar),
    classCredits: String(p.class_pack.credits),
    classQar: String(p.class_pack.qar),
    baseQar: String(p.print.base_qar),
    perGram: String(p.print.per_gram_qar),
    freeDelivery: p.free_delivery_class_order,
  };
}

/** NaN for an empty or non-numeric box, so the shared schema reports the field. */
const num = (s: string): number => (s.trim() === "" ? Number.NaN : Number(s));

function toInput(d: Draft) {
  return {
    team_pack: { credits: num(d.teamCredits), qar: num(d.teamQar) },
    class_pack: { credits: num(d.classCredits), qar: num(d.classQar) },
    print: { base_qar: num(d.baseQar), per_gram_qar: num(d.perGram) },
    free_delivery_class_order: d.freeDelivery,
  };
}

/** "Works out at …" for a pack, only once both of its boxes are real numbers. */
function perCreditText(credits: string, qar: string): string | null {
  const c = num(credits);
  const q = num(qar);
  if (!Number.isFinite(c) || !Number.isFinite(q) || c <= 0) return null;
  return formatQar(perCreditQar({ credits: c, qar: q }));
}

export function SchoolPricingEditor({ locale, initial }: { locale: string; initial: SchoolPricing }) {
  const t = useTranslations("SchoolsAdmin");
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(() => toDraft(initial));
  const [errors, setErrors] = useState<SchoolPricingError[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const patch = (name: keyof Draft, value: string | boolean) => {
    setDraft((d) => ({ ...d, [name]: value }));
    setMsg(null);
  };

  const bad = (field: string) => errors.some((e) => e.field === field);

  const save = () =>
    start(async () => {
      const value = toInput(draft);
      // Same schema as the server: show the problems without a round trip.
      const local = validateSchoolPricing(value);
      if (!local.ok) {
        setErrors(local.errors);
        setMsg(t("error"));
        return;
      }
      const r = await saveSchoolPricing(locale, value);
      if (!r.ok) {
        setErrors(r.errors);
        setMsg(
          r.errors.length
            ? t("error")
            : r.message === "forbidden"
              ? t("forbidden")
              : r.message === "run_migration"
                ? t("runMigration")
                : t("error"),
        );
        return;
      }
      setErrors([]);
      setMsg(t("saved"));
      router.refresh();
    });

  const field = (name: keyof Draft, errorField: string, label: string, opts: { step?: string } = {}) => {
    const id = `school-${name}`;
    return (
      <div className="min-w-0 space-y-1">
        <label htmlFor={id} className="block text-xs font-medium text-body">
          {label}
        </label>
        <input
          id={id}
          type="number"
          inputMode="decimal"
          min="0"
          step={opts.step ?? "1"}
          dir="ltr"
          value={String(draft[name])}
          onChange={(e) => patch(name, e.target.value)}
          aria-invalid={bad(errorField) || undefined}
          className={`${input} ${bad(errorField) ? invalid : ""}`}
        />
      </div>
    );
  };

  const teamPerCredit = perCreditText(draft.teamCredits, draft.teamQar);
  const classPerCredit = perCreditText(draft.classCredits, draft.classQar);

  return (
    <div className="neu space-y-5 p-6">
      <fieldset className="tile min-w-0 space-y-3">
        <legend className="sr-only">{t("teamPackHeading")}</legend>
        <p className="text-sm font-semibold text-heading">{t("teamPackHeading")}</p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {field("teamCredits", "team_pack.credits", t("credits"))}
          {field("teamQar", "team_pack.qar", t("qar"), { step: "0.01" })}
        </div>
        {teamPerCredit && <p className="text-xs text-mutedtext">{t("perCredit", { price: teamPerCredit })}</p>}
      </fieldset>

      <fieldset className="tile min-w-0 space-y-3">
        <legend className="sr-only">{t("classPackHeading")}</legend>
        <p className="text-sm font-semibold text-heading">{t("classPackHeading")}</p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {field("classCredits", "class_pack.credits", t("credits"))}
          {field("classQar", "class_pack.qar", t("qar"), { step: "0.01" })}
        </div>
        {classPerCredit && <p className="text-xs text-mutedtext">{t("perCredit", { price: classPerCredit })}</p>}
      </fieldset>

      <fieldset className="tile min-w-0 space-y-3">
        <legend className="sr-only">{t("printHeading")}</legend>
        <p className="text-sm font-semibold text-heading">{t("printHeading")}</p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {field("baseQar", "print.base_qar", t("baseQar"), { step: "0.01" })}
          {field("perGram", "print.per_gram_qar", t("perGram"), { step: "0.01" })}
        </div>
      </fieldset>

      <fieldset className="tile min-w-0 space-y-3">
        <legend className="sr-only">{t("deliveryHeading")}</legend>
        <p className="text-sm font-semibold text-heading">{t("deliveryHeading")}</p>
        <label className="flex min-h-11 items-center gap-2 text-sm text-body">
          <input
            type="checkbox"
            checked={draft.freeDelivery}
            onChange={(e) => patch("freeDelivery", e.target.checked)}
            className="h-4 w-4 rounded border-borderstrong text-cobalt focus:ring-2 focus:ring-cobalt/60"
          />
          {t("freeDelivery")}
        </label>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={save}
          className="inline-flex items-center gap-1.5 rounded-full bg-cobalt px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50 max-md:min-h-11"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
          {pending ? t("saving") : t("save")}
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
