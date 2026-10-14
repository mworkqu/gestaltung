"use client";

// Shared CAD Champions upload box (Get Ready practice upload now; the test
// workspace in Prompt 5). Files go straight from the browser to Supabase
// Storage with the student's own session (RLS: own folder only):
// - up to 6 MB: supabase-js upload();
// - above 6 MB: TUS resumable upload, so a dropped connection resumes.
// Checks before upload: extension, size, empty file, STEP header
// ("ISO-10303-21" in the first 64 bytes). The server re-checks the stored
// object (lib/cad-champions/upload/actions.ts) before anything is graded.

import * as React from "react";
import Link from "next/link";
import { CheckCircle2, CloudUpload, OctagonAlert, RotateCcw, WifiOff } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { Button } from "@/components/cad-champions/ui";
import type { Locale } from "@/i18n/routing";
import { formatFileSize } from "@/lib/cad-champions/format";
import { Ltr } from "@/lib/cad-champions/ltr";
import { ccPath } from "@/lib/cad-champions/routes";
import { sha256File } from "@/lib/cad-champions/upload/hash";
import { startTusUpload, type TusHandle } from "@/lib/cad-champions/upload/tus";
import {
  DEFAULT_MAX_BYTES,
  HEADER_BYTES,
  acceptAttribute,
  buildObjectPath,
  chooseUploadMethod,
  contentTypeFor,
  validateFileMeta,
  validateHeader,
  type UploadAccept,
  type UploadErrorCode,
  type UploadValidation,
} from "@/lib/cad-champions/upload/validate";
import { cn } from "@/lib/utils";

export interface UploadedFile {
  /** Object path inside the bucket. */
  path: string;
  fileName: string;
  size: number;
  sha256: string;
}

export interface UploadBoxProps {
  accept: UploadAccept;
  /** Default 50 MB. */
  maxBytes?: number;
  bucket: string;
  /** Folder inside the bucket, ending in "/", e.g. `${userId}/practice/`. */
  pathPrefix: string;
  /** Called after the file is stored. The box shows "Uploaded" right away. */
  onUploaded: (file: UploadedFile) => void | Promise<void>;
  /** Show "Replace file" after an upload (default true). */
  replaceable?: boolean;
  disabled?: boolean;
  /** A file uploaded earlier (shown as the current file). */
  current?: { fileName: string; size: number } | null;
  /** Visible label above the drop zone (defaults to "Upload a file"). */
  label?: string;
  /** Help article for "not a STEP file" (default: export-step-inventor). */
  stepHelpSlug?: string;
  /** Told when an upload starts or ends (e.g. to disable a Submit button). */
  onBusyChange?: (busy: boolean) => void;
}

type Phase = "idle" | "checking" | "uploading" | "waiting" | "uploaded" | "failed";

type UploadError = { code: UploadErrorCode | "server"; ext?: string; size?: number };

type Pending = { fileName: string; size: number; progress: number };

class UploadFailure extends Error {
  constructor(public readonly code: UploadErrorCode) {
    super(code);
  }
}

function isDuplicate(error: { message?: string; statusCode?: string | number } | null): boolean {
  if (!error) return false;
  return String(error.statusCode ?? "") === "409" || /already exists|duplicate/i.test(error.message ?? "");
}

export function UploadBox({
  accept,
  maxBytes = DEFAULT_MAX_BYTES,
  bucket,
  pathPrefix,
  onUploaded,
  replaceable = true,
  disabled = false,
  current = null,
  label,
  stepHelpSlug = "export-step-inventor",
  onBusyChange,
}: UploadBoxProps) {
  const t = useTranslations("CC.upload");
  const locale = useLocale() as Locale;
  const inputId = React.useId();
  const statusId = React.useId();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const tusRef = React.useRef<TusHandle | null>(null);
  const retryRef = React.useRef<(() => void) | null>(null);

  const [phase, setPhase] = React.useState<Phase>(current ? "uploaded" : "idle");
  const [stored, setStored] = React.useState<{ fileName: string; size: number } | null>(current);
  const [pending, setPending] = React.useState<Pending | null>(null);
  const [error, setError] = React.useState<UploadError | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const [offline, setOffline] = React.useState(false);
  const [resuming, setResuming] = React.useState(false);

  const busy = phase === "checking" || phase === "uploading" || phase === "waiting";

  React.useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  React.useEffect(() => {
    setStored(current);
  }, [current]);

  // Connection monitor: offline banner + auto-retry when the connection is back.
  React.useEffect(() => {
    setOffline(typeof navigator !== "undefined" && navigator.onLine === false);
    const goOffline = () => setOffline(true);
    const goOnline = () => {
      setOffline(false);
      if (retryRef.current) {
        setResuming(true);
        const retry = retryRef.current;
        retryRef.current = null;
        retry();
      }
    };
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, []);

  // Warn before leaving while an upload is running.
  React.useEffect(() => {
    if (!busy) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = t("leaveWarning");
      return t("leaveWarning");
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [busy, t]);

  // Stop a running TUS upload when the box unmounts.
  React.useEffect(() => {
    return () => {
      tusRef.current?.abort();
    };
  }, []);

  function fail(v: UploadValidation | { ok: false; code: UploadErrorCode }, size?: number) {
    if (v.ok) return;
    setError({ code: v.code, ext: "extension" in v ? v.extension : undefined, size: "sizeBytes" in v ? v.sizeBytes : size });
    setPending(null);
    setPhase("failed");
  }

  async function send(file: File, path: string, sha256: string) {
    setResuming(false);
    setPhase("uploading");
    setError(null);
    try {
      const { createClient } = await import("@/lib/supabase/client");
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new UploadFailure("signed_out");
      const contentType = contentTypeFor(file.name, accept);

      if (chooseUploadMethod(file.size) === "standard") {
        const { error: upErr } = await supabase.storage.from(bucket).upload(path, file, { contentType, upsert: false, cacheControl: "3600" });
        // A duplicate means an earlier attempt of this same upload already landed (paths are unique per upload).
        if (upErr && !isDuplicate(upErr as { message?: string; statusCode?: string | number })) throw upErr;
        setPending((p) => (p ? { ...p, progress: 100 } : p));
      } else {
        const handle = await startTusUpload({
          file,
          bucket,
          objectName: path,
          contentType,
          accessToken: session.access_token,
          supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
          anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
          onProgress: (sent, total) => setPending((p) => (p ? { ...p, progress: total > 0 ? Math.floor((sent / total) * 100) : 0 } : p)),
        });
        tusRef.current = handle;
        await handle.done;
        tusRef.current = null;
      }

      retryRef.current = null;
    } catch (e) {
      tusRef.current = null;
      if (e instanceof UploadFailure) {
        fail({ ok: false, code: e.code });
        return;
      }
      console.error("[cc-upload] upload failed:", e instanceof Error ? e.message : e);
      retryRef.current = () => void send(file, path, sha256);
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        setError({ code: "interrupted" });
        setPhase("waiting");
      } else {
        setError({ code: "failed" });
        setPhase("failed");
      }
      return;
    }

    setStored({ fileName: file.name, size: file.size });
    setPending(null);
    setPhase("uploaded");
    try {
      await onUploaded({ path, fileName: file.name, size: file.size, sha256 });
    } catch (e) {
      console.error("[cc-upload] onUploaded failed:", e instanceof Error ? e.message : e);
    }
  }

  async function handleFile(file: File | undefined) {
    if (!file || disabled || busy) return;
    retryRef.current = null;
    setError(null);
    const meta = validateFileMeta(file, accept, maxBytes);
    if (!meta.ok) return fail(meta, file.size);

    setPending({ fileName: file.name, size: file.size, progress: 0 });
    setPhase("checking");
    try {
      const head = new Uint8Array(await file.slice(0, HEADER_BYTES).arrayBuffer());
      const headerCheck = validateHeader(head, accept);
      if (!headerCheck.ok) return fail(headerCheck);
      const sha256 = await sha256File(file);
      await send(file, buildObjectPath(pathPrefix, file.name), sha256);
    } catch (e) {
      console.error("[cc-upload] could not read file:", e instanceof Error ? e.message : e);
      fail({ ok: false, code: "failed" });
    }
  }

  function retry() {
    const r = retryRef.current;
    if (r) {
      retryRef.current = null;
      r();
    } else {
      inputRef.current?.click();
    }
  }

  function errorText(err: UploadError): string {
    const type = t(`types.${accept}`);
    switch (err.code) {
      case "wrong_extension":
        return err.ext ? t("errors.wrong_extension", { type, ext: err.ext }) : t("errors.wrong_extension_none", { type });
      case "too_large":
        return t("errors.too_large", { max: formatFileSize(maxBytes, locale), size: formatFileSize(err.size ?? 0, locale) });
      case "not_step":
        return t("errors.not_step");
      case "empty":
        return t("errors.empty");
      case "interrupted":
        return t("errors.interrupted");
      case "signed_out":
        return t("errors.signed_out");
      case "server":
        return t("errors.server");
      default:
        return t("errors.failed");
    }
  }

  function errorHelp(err: UploadError): { slug: string; label: string } | null {
    if (err.code === "too_large") return { slug: "my-file-is-too-large", label: t("help.tooLarge") };
    if (err.code === "not_step") return { slug: stepHelpSlug, label: t("help.notStep") };
    if (err.code === "empty" || err.code === "wrong_extension") return { slug: "my-file-was-rejected", label: t("help.rejected") };
    return null;
  }

  const showDropzone = !busy && phase !== "uploaded";
  const showReplace = phase === "uploaded" && replaceable && !disabled;
  const help = error ? errorHelp(error) : null;

  return (
    <div className="space-y-3">
      {offline ? (
        <div role="status" className="flex items-start gap-3 rounded-2xl border border-inventory/20 bg-inventory-bg p-4">
          <WifiOff aria-hidden="true" strokeWidth={1.75} className="mt-0.5 h-5 w-5 shrink-0 text-inventory" />
          <div>
            <p className="text-sm font-bold text-ink">{t("offline.title")}</p>
            <p className="mt-1 text-sm text-body">{t("offline.body")}</p>
          </div>
        </div>
      ) : null}

      <p id={`${inputId}-label`} className="text-sm font-bold text-ink">
        {label ?? t("dropzone.label")}
      </p>

      {/* Current (stored) file: stays visible until a new upload completes. */}
      {stored && (phase === "uploaded" || busy || phase === "failed") ? (
        <div className="tile flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <CheckCircle2 aria-hidden="true" strokeWidth={1.75} className="mt-0.5 h-5 w-5 shrink-0 text-buy" />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-buy">{phase === "uploaded" ? t("state.uploaded") : t("state.previous")}</p>
              <p className="truncate text-sm font-bold text-ink">
                <Ltr>{stored.fileName}</Ltr>
              </p>
              <p className="text-xs text-body">
                <Ltr>{formatFileSize(stored.size, locale)}</Ltr>
              </p>
            </div>
          </div>
          {showReplace ? (
            <Button type="button" variant="secondary" size="sm" onClick={() => inputRef.current?.click()}>
              <RotateCcw aria-hidden="true" strokeWidth={1.75} className="h-4 w-4" />
              {t("state.replace")}
            </Button>
          ) : null}
        </div>
      ) : null}

      {/* In-flight upload */}
      {pending && busy ? (
        <div className="tile space-y-2" aria-live="polite">
          <div className="flex items-center justify-between gap-3">
            <p className="min-w-0 truncate text-sm font-bold text-ink">
              <Ltr>{pending.fileName}</Ltr>
            </p>
            <p className="shrink-0 text-xs text-body">
              <Ltr>{formatFileSize(pending.size, locale)}</Ltr>
            </p>
          </div>
          <div
            role="progressbar"
            aria-label={t("state.progressLabel", { name: pending.fileName })}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pending.progress}
            className="h-2 w-full overflow-hidden rounded-full bg-panel"
          >
            <div
              className={cn("h-full rounded-full bg-accent transition-[width] duration-300", phase === "checking" && "motion-safe:animate-pulse")}
              style={{ width: `${phase === "checking" ? 8 : Math.max(4, pending.progress)}%` }}
            />
          </div>
          <p className="text-xs font-semibold text-body">
            {phase === "checking"
              ? t("state.checking")
              : phase === "waiting"
                ? t("errors.interrupted")
                : resuming
                  ? t("state.resuming")
                  : t("state.uploading", { percent: String(pending.progress) })}
          </p>
          {stored ? <p className="text-xs text-body">{t("state.keepPrevious")}</p> : null}
        </div>
      ) : null}

      {error && phase === "failed" ? (
        <div role="alert" className="flex flex-col gap-3 rounded-2xl border border-[#f3c4c2] bg-[#fdecec] p-4 sm:flex-row sm:items-start">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <OctagonAlert aria-hidden="true" strokeWidth={1.75} className="mt-0.5 h-5 w-5 shrink-0 text-[#a1231f]" />
            <div className="min-w-0">
              <p className="text-sm font-bold text-ink">{t("state.failed")}</p>
              <p className="mt-1 text-sm text-body">{errorText(error)}</p>
              {help ? (
                <Link href={ccPath(locale, `/help/${help.slug}`)} className="mt-1 inline-block text-sm font-semibold text-accent underline-offset-2 hover:underline">
                  {help.label}
                </Link>
              ) : null}
            </div>
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={retry} disabled={disabled}>
            <RotateCcw aria-hidden="true" strokeWidth={1.75} className="h-4 w-4" />
            {t("state.retry")}
          </Button>
        </div>
      ) : null}

      {showDropzone ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            if (!disabled) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void handleFile(e.dataTransfer.files?.[0]);
          }}
          aria-describedby={statusId}
          className={cn(
            "flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-6 text-center transition-colors",
            dragging ? "border-accent bg-[#e3edfb]" : "border-border bg-surface",
            disabled && "opacity-60"
          )}
        >
          <CloudUpload aria-hidden="true" strokeWidth={1.5} className="h-8 w-8 text-accent" />
          <p className="text-sm font-bold text-ink">{dragging ? t("dropzone.dropHere") : t("dropzone.title")}</p>
          <p className="text-xs text-body">{t("dropzone.or")}</p>
          <Button type="button" variant="primary" size="sm" disabled={disabled} onClick={() => inputRef.current?.click()}>
            {t("dropzone.choose")}
          </Button>
          <p id={statusId} className="text-xs text-body">
            {t("dropzone.accepts", { type: t(`types.${accept}`), max: formatFileSize(maxBytes, locale) })}
          </p>
        </div>
      ) : null}

      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={acceptAttribute(accept)}
        aria-labelledby={`${inputId}-label`}
        className="sr-only"
        tabIndex={-1}
        disabled={disabled || busy}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          void handleFile(file);
        }}
      />
    </div>
  );
}
