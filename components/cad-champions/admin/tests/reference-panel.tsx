"use client";

import * as React from "react";
import { CheckCircle2, Ruler } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { extractReferenceAction, saveReferenceAction, type Target } from "@/app/[locale]/cad-champions/admin/tests/content-actions";
import { inputCls } from "@/components/cad-champions/admin/fields";
import { UploadBox } from "@/components/cad-champions/upload/upload-box";
import { Alert, Button, HelpTip, Spinner, StatusChip } from "@/components/cad-champions/ui";
import type { Locale } from "@/i18n/routing";
import { answerFilesPrefix, isValidPartName, referenceView, type ReferenceView } from "@/lib/cad-champions/admin/test-builder";
import { formatNumber } from "@/lib/cad-champions/format";
import { isReferenceComplete } from "@/lib/cad-champions/grader/mapping";
import { Ltr } from "@/lib/cad-champions/ltr";

import { useAdminAction } from "./use-admin-action";

// "Reference data from an answer file" (Prompt 11 Step B): answer STEP ->
// cc-answer-files (staff only) -> grader /reference -> the numbers -> the
// admin names each part of an assembly -> "Save as reference".

function Numbers({ view }: { view: ReferenceView }) {
  const t = useTranslations("CC.admin.tests");
  const locale = useLocale() as Locale;
  const n = (v: number | null, d = 2) => (v == null ? "-" : formatNumber(v, locale, { maximumFractionDigits: d }));
  const rows: [string, string][] = [
    [t("reference.volume"), `${n(view.volume_mm3)} mm³`],
    [t("reference.area"), `${n(view.area_mm2)} mm²`],
    [t("reference.mass"), `${n(view.mass_kg, 4)} kg`],
    [t("reference.density"), `${n(view.density_kg_m3, 1)} kg/m³`],
    [t("reference.solids"), n(view.solids, 0)],
    [t("reference.moments"), view.principal_moments_mm5.map((m) => n(m, 0)).join(" / ") + " mm⁵"],
  ];
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
      {rows.map(([k, v]) => (
        <div key={k} className="flex flex-col">
          <dt className="text-xs font-semibold text-mutedtext">{k}</dt>
          <dd className="text-ink">
            <Ltr>{v}</Ltr>
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function ReferencePanel({ target, reference, graderReady, isAssembly }: { target: Target; reference: unknown; graderReady: boolean; isAssembly: boolean }) {
  const t = useTranslations("CC.admin.tests");
  const tc = useTranslations("CC.admin.common");
  const locale = useLocale() as Locale;
  const { run, busy, errorText } = useAdminAction();
  const [extracting, setExtracting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<{ reference: Record<string, unknown>; warnings: string[] } | null>(null);
  const [names, setNames] = React.useState<string[]>([]);
  const [boxKey, setBoxKey] = React.useState(0);

  const saved = referenceView(reference);
  const savedComplete = isReferenceComplete(reference);
  const draftView = draft ? referenceView(draft.reference) : null;
  const showNames = !!draftView && (isAssembly || draftView.parts.length > 1);
  const namesOk = names.every((x) => !x.trim() || isValidPartName(x)) && new Set(names.map((x, i) => (x.trim() || draftView?.parts[i]?.name || "").toLowerCase())).size === names.length;

  async function extract(path: string) {
    setError(null);
    setDraft(null);
    setExtracting(true);
    try {
      const res = await extractReferenceAction({ target, path });
      if (res.ok) {
        setDraft(res.data);
        setNames((referenceView(res.data.reference)?.parts ?? []).map(() => ""));
      } else setError(errorText(res));
    } catch (e) {
      console.error("[cc-admin] reference failed:", e instanceof Error ? e.message : "unknown");
      setError(errorText({ ok: false, error: "error" }));
    } finally {
      setExtracting(false);
      setBoxKey((k) => k + 1);
    }
  }

  async function save() {
    if (!draft) return;
    const res = await run(() => saveReferenceAction({ target, reference: draft.reference, partNames: names }), { success: t("reference.saved"), successBody: t("reference.savedBody") });
    if (res?.ok) setDraft(null);
  }

  return (
    <section className="flex flex-col gap-4" aria-label={t("reference.title")}>
      <h4 className="flex items-center gap-1 text-base font-bold text-heading">
        <Ruler aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />
        {t("reference.title")}
        <HelpTip label={t("reference.helpLabel")}>{t("reference.help")}</HelpTip>
      </h4>

      <div className="flex flex-wrap items-center gap-2">
        <StatusChip tone={savedComplete ? "success" : "warning"}>{savedComplete ? t("reference.statusComplete") : t("reference.statusMissing")}</StatusChip>
      </div>
      {saved && savedComplete ? (
        <div className="tile flex flex-col gap-3">
          <p className="text-sm font-semibold text-ink">{t("reference.current")}</p>
          <Numbers view={saved} />
          {saved.parts.length > 0 ? (
            <p className="text-xs text-mutedtext">
              {t("reference.parts")}: <Ltr>{saved.parts.map((p) => p.name).join(", ")}</Ltr>
            </p>
          ) : null}
        </div>
      ) : null}

      {!graderReady ? (
        <Alert tone="info" title={t("reference.notConfiguredTitle")}>
          {t("reference.notConfiguredBody")}
        </Alert>
      ) : (
        <>
          <UploadBox key={boxKey} accept="step" bucket="cc-answer-files" pathPrefix={answerFilesPrefix(target.kind, target.id)} replaceable={false} label={t("reference.uploadLabel")} onUploaded={(f) => extract(f.path)} disabled={extracting} />
          {extracting ? (
            <p className="flex items-center gap-2 text-sm text-mutedtext">
              <Spinner size="sm" label={t("reference.reading")} />
            </p>
          ) : null}
          {error ? <Alert tone="error" title={t("reference.failedTitle")}>{error}</Alert> : null}
        </>
      )}

      {draft && draftView ? (
        <div className="tile flex flex-col gap-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-ink">
            <CheckCircle2 aria-hidden="true" className="h-4 w-4 text-buy" strokeWidth={1.75} />
            {t("reference.extracted")}
          </p>
          <Numbers view={draftView} />
          {draft.warnings.length > 0 ? (
            <Alert tone="warning" title={t("reference.warnings")}>
              <Ltr>{draft.warnings.join(", ")}</Ltr>
            </Alert>
          ) : null}
          {showNames ? (
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-semibold text-ink">{t("reference.nameParts")}</legend>
              <p className="text-xs text-mutedtext">{t("reference.namePartsHint")}</p>
              <ol className="flex flex-col gap-2">
                {draftView.parts.map((p, i) => (
                  <li key={i} className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                    <span className="text-sm text-mutedtext">
                      <Ltr>{`${p.name} · ${p.volume_mm3 == null ? "-" : formatNumber(p.volume_mm3, locale, { maximumFractionDigits: 1 })} mm³`}</Ltr>
                    </span>
                    <input
                      className={inputCls}
                      dir="ltr"
                      aria-label={t("reference.partName", { n: formatNumber(i + 1, locale) })}
                      placeholder={p.name}
                      value={names[i] ?? ""}
                      onChange={(e) => setNames((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))}
                    />
                  </li>
                ))}
              </ol>
              {!namesOk ? <p className="text-sm font-semibold text-destructive">{t("errors.part_names")}</p> : null}
            </fieldset>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={save} loading={busy} loadingText={tc("saving")} disabled={!namesOk}>
              {t("reference.save")}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setDraft(null)}>
              {tc("cancel")}
            </Button>
          </div>
          {savedComplete ? <p className="text-xs text-mutedtext">{t("reference.replaceNote")}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
