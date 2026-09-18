"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { FileUp, Loader2, Trash2 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { ensureSession } from "@/lib/supabase/guest";
import {
  ACCEPT_ATTR,
  CAD_BUCKET,
  EXT_ALIASES,
  MAX_FILE_BYTES,
} from "@/lib/design/constants";
import { Tag } from "@/components/ui/tag";

type ProjectFile = {
  id: string;
  file_name: string;
  file_ext: string;
  size_bytes: number | null;
  storage_path: string;
};

// Attach a CAD file to a project. The file goes straight from the browser to
// the private cad-files bucket (keeping big files off the 4.5 MB server-action
// limit), then a notification is posted so the owner can quote it by hand.
// No method detection, no dispatch — that pipeline is gone.
export function ProjectCadCard({ projectId }: { projectId: string }) {
  const t = useTranslations("ProjectCad");
  const locale = useLocale();

  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [notified, setNotified] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const { data } = await createClient()
      .from("project_files")
      .select("id, file_name, file_ext, size_bytes, storage_path")
      .eq("project_id", projectId)
      .order("uploaded_at", { ascending: true });
    setFiles((data ?? []) as ProjectFile[]);
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function upload(file: File) {
    setError(null);
    setNotified(false);

    const ext = EXT_ALIASES[file.name.split(".").pop()?.toLowerCase() ?? ""];
    if (!ext) {
      setError(t("wrongType"));
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setError(t("tooLarge"));
      return;
    }

    setBusy(true);
    try {
      const user = await ensureSession();
      const supabase = createClient();
      const path = `${user.id}/${projectId}/${crypto.randomUUID()}-${file.name}`;

      const { error: upErr } = await supabase.storage
        .from(CAD_BUCKET)
        .upload(path, file);
      if (upErr) throw upErr;

      const { error: rowErr } = await supabase.from("project_files").insert({
        project_id: projectId,
        storage_path: path,
        file_name: file.name,
        file_ext: ext,
        size_bytes: file.size,
      });
      if (rowErr) throw rowErr;

      // Tell the owner. Failure here is not fatal — the file is already saved
      // and visible on the project.
      const res = await fetch("/api/project-cad", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          storage_path: path,
          file_name: file.name,
          file_size: file.size,
          locale,
        }),
      });
      setNotified(res.ok);

      await load();
    } catch {
      setError(t("uploadFailed"));
    }
    setBusy(false);
  }

  async function remove(file: ProjectFile) {
    setBusy(true);
    const supabase = createClient();
    await supabase.storage.from(CAD_BUCKET).remove([file.storage_path]);
    await supabase.from("project_files").delete().eq("id", file.id);
    await load();
    setBusy(false);
  }

  return (
    <section className="neu space-y-4 p-6 sm:p-8">
      <div>
        <h2 className="text-sm font-semibold text-heading">{t("heading")}</h2>
        <p className="mt-1 text-sm text-mutedtext">{t("intro")}</p>
      </div>

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="inline-flex items-center rounded-lg bg-panel px-3.5 py-2 text-xs font-semibold text-heading shadow-neu-sm transition-colors hover:text-cobalt disabled:opacity-60"
      >
        {busy ? (
          <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />
        ) : (
          <FileUp className="me-1.5 h-3.5 w-3.5" />
        )}
        {busy ? t("uploading") : t("attach")}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_ATTR}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
          e.target.value = "";
        }}
      />

      {error && <p className="text-sm font-medium text-destructive">{error}</p>}
      {notified && <p className="text-sm text-buy">{t("notified")}</p>}

      {files.length === 0 ? (
        <p className="text-sm text-mutedtext">{t("empty")}</p>
      ) : (
        <ul className="space-y-2">
          {files.map((f) => (
            <li
              key={f.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-panel px-3 py-2.5 shadow-neu-sm"
            >
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-heading">
                {f.file_name}
              </span>
              <Tag variant="neutral">{f.file_ext.toUpperCase()}</Tag>
              {f.size_bytes ? (
                <span className="shrink-0 text-[11px] tabular-nums text-mutedtext">
                  {(f.size_bytes / 1024 / 1024).toFixed(1)} MB
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => remove(f)}
                disabled={busy}
                aria-label={t("remove")}
                className="shrink-0 rounded-md p-1.5 text-mutedtext transition-colors hover:text-destructive disabled:opacity-40"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
