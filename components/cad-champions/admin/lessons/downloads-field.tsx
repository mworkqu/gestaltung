"use client";

import * as React from "react";
import { Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { BilingualField } from "@/components/cad-champions/admin/fields";
import { UploadBox } from "@/components/cad-champions/upload/upload-box";
import { Button } from "@/components/cad-champions/ui";
import { DOWNLOADS_MAX, type LessonDownload } from "@/lib/cad-champions/admin/lessons";
import { Ltr } from "@/lib/cad-champions/ltr";
import type { UploadAccept } from "@/lib/cad-champions/upload/validate";

import { selectCls } from "./shared";

// Lesson downloads: files go from the browser to the cc-lesson-files bucket
// (admins may write, 0078 RLS) and are stored as a JSON list
// [{path, label_en, label_ar}] on the lesson.

const ACCEPTS: UploadAccept[] = ["pdf", "zip", "step", "image"];

export function DownloadsField({ lessonId, items, onChange }: { lessonId: string; items: LessonDownload[]; onChange: (next: LessonDownload[]) => void }) {
  const t = useTranslations("CC.admin.lessons");
  const [accept, setAccept] = React.useState<UploadAccept>("pdf");
  const [busy, setBusy] = React.useState(false);
  const full = items.length >= DOWNLOADS_MAX;
  const patch = (i: number, p: Partial<LessonDownload>) => onChange(items.map((it, idx) => (idx === i ? { ...it, ...p } : it)));

  return (
    <div className="flex flex-col gap-4">
      {items.length === 0 ? <p className="text-sm text-mutedtext">{t("downloads.empty")}</p> : null}
      <ul className="flex flex-col gap-4">
        {items.map((d, i) => (
          <li key={d.path} className="flex flex-col gap-3 rounded-2xl border border-border p-3">
            <div className="flex items-start justify-between gap-3">
              <Ltr className="min-w-0 break-all font-mono text-xs text-mutedtext">{d.path}</Ltr>
              <Button type="button" variant="ghost" size="sm" onClick={() => onChange(items.filter((_, idx) => idx !== i))} aria-label={t("downloads.remove")}>
                <Trash2 aria-hidden="true" className="h-4 w-4" />
                {t("downloads.remove")}
              </Button>
            </div>
            <BilingualField label={t("downloads.label")} maxLength={120} en={{ value: d.label_en, onChange: (v) => patch(i, { label_en: v }) }} ar={{ value: d.label_ar, onChange: (v) => patch(i, { label_ar: v }) }} />
          </li>
        ))}
      </ul>
      {full ? (
        <p className="text-sm text-mutedtext">{t("downloads.full", { max: DOWNLOADS_MAX })}</p>
      ) : (
        <div className="flex flex-col gap-3 rounded-2xl border border-dashed border-border p-3">
          <label className="flex max-w-xs flex-col gap-1 text-sm font-semibold text-ink">
            {t("downloads.type")}
            <select className={selectCls} value={accept} disabled={busy} onChange={(e) => setAccept(e.target.value as UploadAccept)}>
              {ACCEPTS.map((a) => (
                <option key={a} value={a}>
                  {t(`downloads.types.${a}`)}
                </option>
              ))}
            </select>
          </label>
          <UploadBox
            key={accept}
            accept={accept}
            bucket="cc-lesson-files"
            pathPrefix={`lessons/${lessonId}/`}
            label={t("downloads.upload")}
            replaceable={false}
            onBusyChange={setBusy}
            onUploaded={(f) => {
              if (items.some((x) => x.path === f.path)) return;
              onChange([...items, { path: f.path, label_en: f.fileName, label_ar: f.fileName }]);
            }}
          />
          <p className="text-xs text-mutedtext">{t("downloads.saveHint")}</p>
        </div>
      )}
    </div>
  );
}
