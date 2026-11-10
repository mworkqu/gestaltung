"use client";

import { useTranslations } from "next-intl";

import { BilingualField } from "@/components/cad-champions/admin/fields";
import { NOTE_TRACKS, type NoteTrack, type TrackNoteMode, type TrackNotesState } from "@/lib/cad-champions/admin/lessons";

import { selectCls } from "./shared";

// Per-track note for lessons that teach an Inventor-only tool: Fusion and
// SOLIDWORKS students either see "Inventor only" or an equivalent-tool note.

export function TrackNotesField({ value, onChange, invalid }: { value: TrackNotesState; onChange: (next: TrackNotesState) => void; invalid?: NoteTrack[] }) {
  const t = useTranslations("CC.admin.lessons");
  const set = (track: NoteTrack, p: Partial<TrackNotesState[NoteTrack]>) => onChange({ ...value, [track]: { ...value[track], ...p } });
  return (
    <div className="flex flex-col gap-5">
      {NOTE_TRACKS.map((track) => {
        const s = value[track];
        return (
          <div key={track} className="flex flex-col gap-3 rounded-2xl border border-border p-3">
            <label className="flex max-w-sm flex-col gap-1 text-sm font-semibold text-ink">
              {t(`tracks.${track}`)}
              <select className={selectCls} value={s.mode} onChange={(e) => set(track, { mode: e.target.value as TrackNoteMode })}>
                <option value="none">{t("trackNotes.none")}</option>
                <option value="inventor_only">{t("trackNotes.inventorOnly")}</option>
                <option value="equivalent">{t("trackNotes.equivalent")}</option>
              </select>
            </label>
            {s.mode === "equivalent" ? (
              <>
                <BilingualField label={t("trackNotes.text")} hint={t("trackNotes.textHint")} multiline rows={3} maxLength={600} en={{ value: s.en, onChange: (v) => set(track, { en: v }) }} ar={{ value: s.ar, onChange: (v) => set(track, { ar: v }) }} />
                {invalid?.includes(track) ? (
                  <p role="alert" className="text-sm text-[#a1231f]">
                    {t("trackNotes.bothRequired")}
                  </p>
                ) : null}
              </>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
