"use client";

import * as React from "react";
import { FileText, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { BilingualField, Field, inputCls } from "@/components/cad-champions/admin/fields";
import { UploadBox } from "@/components/cad-champions/upload/upload-box";
import { Alert, Button, HelpTip } from "@/components/cad-champions/ui";
import { ATTACHMENT_KINDS, attachmentKindFor } from "@/lib/cad-champions/admin/test-builder";
import type { CcAttachment } from "@/lib/cad-champions/db/types";
import { Ltr } from "@/lib/cad-champions/ltr";
import type { UploadAccept } from "@/lib/cad-champions/upload/validate";

// Files students download for a task or exercise (brief PDF, drawings,
// images, given part files). Stored in cc-task-files (every signed-in user
// can read it: NEVER put answer files here) as CcAttachment[] on the row.
// Saved with the task form.

const ACCEPTS: UploadAccept[] = ["pdf", "image", "step"];

export function AttachmentsEditor({ value, onChange, prefix }: { value: CcAttachment[]; onChange: (v: CcAttachment[]) => void; prefix: string | null }) {
  const t = useTranslations("CC.admin.tests");
  const [accept, setAccept] = React.useState<UploadAccept>("pdf");
  const [boxKey, setBoxKey] = React.useState(0);

  const update = (i: number, patch: Partial<CcAttachment>) => onChange(value.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  const stem = (name: string) => name.replace(/\.[^.]+$/, "");

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="flex items-center gap-1 text-sm font-semibold text-ink">
        {t("attachments.title")}
        <HelpTip label={t("attachments.helpLabel")}>{t("attachments.help")}</HelpTip>
      </legend>

      {value.length === 0 ? <p className="text-sm text-mutedtext">{t("attachments.empty")}</p> : null}
      <ul className="flex flex-col gap-3">
        {value.map((a, i) => (
          <li key={a.path} className="tile flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-ink">
                <FileText aria-hidden="true" className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                <Ltr className="truncate">{a.path.split("/").pop()}</Ltr>
              </span>
              <Button type="button" variant="ghost" size="sm" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label={t("attachments.remove", { name: a.path.split("/").pop() ?? "" })}>
                <Trash2 aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />
                {t("attachments.removeShort")}
              </Button>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_12rem]">
              <BilingualField label={t("attachments.label")} maxLength={200} en={{ value: a.label_en ?? "", onChange: (v) => update(i, { label_en: v }) }} ar={{ value: a.label_ar ?? "", onChange: (v) => update(i, { label_ar: v }) }} />
              <Field label={t("attachments.kind")}>
                <select className={inputCls} value={a.kind ?? "file"} onChange={(e) => update(i, { kind: e.target.value })}>
                  {ATTACHMENT_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {t(`attachments.kinds.${k}`)}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </li>
        ))}
      </ul>

      {prefix ? (
        <div className="flex flex-col gap-3">
          <div role="radiogroup" aria-label={t("attachments.typeLabel")} className="flex flex-wrap gap-2">
            {ACCEPTS.map((x) => (
              <button
                key={x}
                type="button"
                role="radio"
                aria-checked={accept === x}
                onClick={() => {
                  setAccept(x);
                  setBoxKey((k) => k + 1);
                }}
                className={
                  accept === x
                    ? "min-h-11 rounded-full bg-accent px-4 text-sm font-semibold text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
                    : "min-h-11 rounded-full border border-border bg-surface px-4 text-sm font-semibold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                }
              >
                {t(`attachments.accept.${x}`)}
              </button>
            ))}
          </div>
          <UploadBox
            key={`${accept}-${boxKey}`}
            accept={accept}
            bucket="cc-task-files"
            pathPrefix={prefix}
            replaceable={false}
            label={t("attachments.uploadLabel")}
            onUploaded={(file) => {
              onChange([...value, { path: file.path, label_en: stem(file.fileName), label_ar: stem(file.fileName), kind: attachmentKindFor(file.fileName) }]);
              setBoxKey((k) => k + 1);
            }}
          />
          {value.length > 0 ? <p className="text-xs text-mutedtext">{t("attachments.saveReminder")}</p> : null}
        </div>
      ) : (
        <Alert tone="info" title={t("attachments.saveFirst")} />
      )}
    </fieldset>
  );
}
