"use client";

import * as React from "react";
import { NotebookPen } from "lucide-react";
import { useTranslations } from "next-intl";

import { addStudentNoteAction, type NoteView } from "@/app/[locale]/cad-champions/admin/students/actions";
import { textareaCls } from "@/components/cad-champions/admin/fields";
import { Button, EmptyState, useToast } from "@/components/cad-champions/ui";
import type { Locale } from "@/i18n/routing";
import { NOTE_MAX } from "@/lib/cad-champions/admin/student-detail";
import { formatDateTime } from "@/lib/cad-champions/format";

// Private trainer notes (staff only; never shown to the student). Newest first.

export function NotesPanel({ locale, studentId, initial }: { locale: Locale; studentId: string; initial: NoteView[] }) {
  const t = useTranslations("CC.admin.students");
  const tc = useTranslations("CC.admin.common");
  const toast = useToast();
  const [notes, setNotes] = React.useState(initial);
  const [body, setBody] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const id = React.useId();

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim() || saving) return;
    setSaving(true);
    try {
      const res = await addStudentNoteAction({ studentId, body });
      if (res.ok) {
        setNotes((n) => [res.data, ...n]);
        setBody("");
        toast.success(t("notes.saved"), t("notes.savedBody"));
      } else {
        toast.error(t("notes.failed"), tc(`errors.${res.error}`));
      }
    } catch (err) {
      console.error("[cc-admin] note failed", err);
      toast.error(t("notes.failed"), tc("errors.error"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={add} className="space-y-2">
        <label htmlFor={id} className="text-sm font-semibold text-ink">
          {t("notes.add")}
        </label>
        <textarea id={id} value={body} onChange={(e) => setBody(e.target.value)} maxLength={NOTE_MAX} rows={3} className={textareaCls} placeholder={t("notes.placeholder")} />
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-mutedtext">{t("notes.private")}</p>
          <Button type="submit" size="sm" loading={saving} loadingText={tc("saving")} disabled={!body.trim()}>
            {t("notes.addButton")}
          </Button>
        </div>
      </form>
      {notes.length === 0 ? (
        <EmptyState icon={NotebookPen} title={t("notes.emptyTitle")} description={t("notes.emptyBody")} />
      ) : (
        <ul className="space-y-3">
          {notes.map((n) => (
            <li key={n.id} className="tile space-y-1">
              <p className="whitespace-pre-wrap text-sm text-body">{n.body}</p>
              <p className="text-xs text-mutedtext">
                {n.authorName ?? t("notes.unknownAuthor")} · {formatDateTime(n.createdAt, locale)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
