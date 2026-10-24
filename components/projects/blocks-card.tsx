"use client";

// The project's notes / images / drawings blocks (split out of project-workspace.tsx, R8).

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, ChevronUp, FileText, ImagePlus, Trash2, Type as TypeIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ensureSession } from "@/lib/supabase/guest";
import {
  MAX_PROJECT_IMAGE_BYTES,
  PROJECT_IMAGE_ACCEPT,
  PROJECT_IMAGE_BUCKET,
} from "@/lib/projects/constants";
import { isPdfPath } from "@/lib/projects/drawing-attachment";
import { cn } from "@/lib/utils";
import type { ProjectBlock } from "@/lib/supabase/types";

export function BlocksCard({
  projectId,
  blocks,
  imageUrls,
  onChanged,
}: {
  projectId: string;
  blocks: ProjectBlock[];
  imageUrls: Record<string, string>;
  onChanged: () => Promise<void>;
}) {
  const t = useTranslations("Projects");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const nextPosition = blocks.length ? Math.max(...blocks.map((b) => b.position)) + 1 : 0;

  async function addText() {
    setBusy(true);
    await createClient()
      .from("project_blocks")
      .insert({ project_id: projectId, type: "text", content: "", position: nextPosition });
    await onChanged();
    setBusy(false);
  }

  async function addImage(file: File) {
    setError(null);
    if (file.size > MAX_PROJECT_IMAGE_BYTES) {
      setError(t("imageTooLarge"));
      return;
    }
    setBusy(true);
    try {
      const user = await ensureSession();
      const supabase = createClient();
      const ext = file.name.split(".").pop() ?? "png";
      const path = `${user.id}/${projectId}/${crypto.randomUUID()}.${ext}`;

      const { error: upErr } = await supabase.storage
        .from(PROJECT_IMAGE_BUCKET)
        .upload(path, file);
      if (upErr) throw upErr;

      await supabase
        .from("project_blocks")
        .insert({ project_id: projectId, type: "image", storage_path: path, position: nextPosition });
      await onChanged();
    } catch {
      setError(t("uploadFailed"));
    }
    setBusy(false);
  }

  async function saveText(id: string, content: string) {
    await createClient().from("project_blocks").update({ content }).eq("id", id);
  }

  async function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= blocks.length) return;
    const a = blocks[index];
    const b = blocks[target];
    setBusy(true);
    const supabase = createClient();
    await Promise.all([
      supabase.from("project_blocks").update({ position: b.position }).eq("id", a.id),
      supabase.from("project_blocks").update({ position: a.position }).eq("id", b.id),
    ]);
    await onChanged();
    setBusy(false);
  }

  async function remove(block: ProjectBlock) {
    setBusy(true);
    const supabase = createClient();
    if (block.storage_path) {
      await supabase.storage.from(PROJECT_IMAGE_BUCKET).remove([block.storage_path]);
    }
    await supabase.from("project_blocks").delete().eq("id", block.id);
    await onChanged();
    setBusy(false);
  }

  return (
    <section className="neu space-y-4 p-6 sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-heading">{t("blocksHeading")}</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={addText}
            disabled={busy}
            className="inline-flex items-center rounded-lg bg-panel px-3 py-1.5 text-xs font-semibold text-heading shadow-neu-sm transition-colors hover:text-cobalt disabled:opacity-60 max-md:min-h-11"
          >
            <TypeIcon className="me-1.5 h-3.5 w-3.5" />
            {t("addText")}
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="inline-flex items-center rounded-lg bg-panel px-3 py-1.5 text-xs font-semibold text-heading shadow-neu-sm transition-colors hover:text-cobalt disabled:opacity-60 max-md:min-h-11"
          >
            <ImagePlus className="me-1.5 h-3.5 w-3.5" />
            {t("addImage")}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept={PROJECT_IMAGE_ACCEPT}
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void addImage(f);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      {error && <p className="text-sm font-medium text-destructive">{error}</p>}

      {blocks.length === 0 ? (
        <p className="text-sm text-mutedtext">{t("emptyBlocks")}</p>
      ) : (
        <ul className="space-y-3">
          {blocks.map((block, i) => (
            <li key={block.id} className="rounded-xl bg-panel p-3 shadow-neu-sm">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  {block.type === "text" ? (
                    <textarea
                      defaultValue={block.content ?? ""}
                      onBlur={(e) => saveText(block.id, e.target.value)}
                      rows={3}
                      placeholder={t("blockPlaceholder")}
                      className="w-full resize-y rounded-lg bg-transparent text-sm leading-relaxed text-heading outline-none placeholder:text-faint"
                    />
                  ) : block.storage_path && imageUrls[block.storage_path] && isPdfPath(block.storage_path) ? (
                    <a
                      href={imageUrls[block.storage_path]}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-cobalt hover:underline"
                    >
                      <FileText className="h-4 w-4" aria-hidden />
                      {t("attachedPdf")}
                    </a>
                  ) : block.storage_path && imageUrls[block.storage_path] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={imageUrls[block.storage_path]}
                      alt=""
                      className="max-h-80 w-auto rounded-lg"
                    />
                  ) : (
                    <p className="text-sm text-mutedtext">{t("uploading")}</p>
                  )}
                </div>

                <div className="flex shrink-0 flex-col gap-1">
                  <IconBtn label={t("moveUp")} onClick={() => move(i, -1)} disabled={busy || i === 0}>
                    <ChevronUp className="h-3.5 w-3.5" />
                  </IconBtn>
                  <IconBtn
                    label={t("moveDown")}
                    onClick={() => move(i, 1)}
                    disabled={busy || i === blocks.length - 1}
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </IconBtn>
                  <IconBtn label={t("remove")} onClick={() => remove(block)} disabled={busy} danger>
                    <Trash2 className="h-3.5 w-3.5" />
                  </IconBtn>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function IconBtn({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        "rounded-md p-1.5 text-mutedtext transition-colors disabled:opacity-30 max-md:min-h-11 max-md:min-w-11 max-md:inline-flex max-md:items-center max-md:justify-center",
        danger ? "hover:text-destructive" : "hover:text-cobalt"
      )}
    >
      {children}
    </button>
  );
}
