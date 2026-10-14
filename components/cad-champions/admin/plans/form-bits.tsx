"use client";

import * as React from "react";
import { useTranslations } from "next-intl";

import { Alert, Button } from "@/components/cad-champions/ui";

/** Server field errors ({ field: code }) as one list: "Price: must be 0 or more". */
export function FormErrors({ errors, fieldLabel }: { errors: Record<string, string> | null; fieldLabel: (field: string) => string }) {
  const t = useTranslations("CC.admin.plans");
  if (!errors || Object.keys(errors).length === 0) return null;
  return (
    <Alert tone="error" title={t("fieldErrors.title")}>
      <ul className="list-disc space-y-0.5 ps-5">
        {Object.entries(errors).map(([field, code]) => (
          <li key={field}>
            {fieldLabel(field)}: {t(`fieldErrors.codes.${code}`)}
          </li>
        ))}
      </ul>
    </Alert>
  );
}

export function SaveBar({ saving, onCancel, disabledReason }: { saving: boolean; onCancel: () => void; disabledReason?: string }) {
  const tc = useTranslations("CC.admin.common");
  return (
    <div className="flex flex-wrap gap-3">
      <Button type="submit" loading={saving} loadingText={tc("saving")} disabled={!!disabledReason} disabledReason={disabledReason}>
        {tc("save")}
      </Button>
      <Button type="button" variant="secondary" onClick={onCancel} disabled={saving}>
        {tc("cancel")}
      </Button>
    </div>
  );
}

/** FormData -> plain values (checkbox names present = "on"; repeated names = array). */
export function formValues(form: HTMLFormElement, arrayNames: string[] = []): Record<string, unknown> {
  const fd = new FormData(form);
  const out: Record<string, unknown> = {};
  for (const key of new Set([...fd.keys()])) {
    out[key] = arrayNames.includes(key) ? fd.getAll(key).map(String) : String(fd.get(key) ?? "");
  }
  for (const n of arrayNames) if (!(n in out)) out[n] = [];
  return out;
}
