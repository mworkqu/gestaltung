"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Loader2, UploadCloud, FileBox, X, CheckCircle2 } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { takePendingUpload } from "@/lib/design/pending-upload";
import { QUOTE_BUCKET } from "@/lib/design/constants";
import { ACCEPT_ATTR, ACCEPT_EXTENSIONS, MAX_FILE_BYTES } from "@/lib/jobs/constants";
import { cn } from "@/lib/utils";

const TECHNIQUES = [
  "3d_printing",
  "cnc_machining",
  "laser_cutting",
  "edm",
  "not_sure",
] as const;

const fieldClass =
  "w-full rounded-xl border border-white/60 bg-panel px-4 py-3 text-sm text-heading shadow-neu-inset transition placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-cobalt/60";

function extOf(name: string) {
  return name.split(".").pop()?.toLowerCase() ?? "";
}
function sanitize(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

type Done = "sent" | "sent_large" | "sent_nofile" | null;

export function QuoteRequest() {
  const t = useTranslations("DesignQuote");
  const locale = useLocale();
  const isRtl = locale === "ar";
  const inputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [technique, setTechnique] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState<Done>(null);

  // Pick up the file the homepage dropzone handed off (client-only).
  useEffect(() => {
    const pending = takePendingUpload();
    if (pending) setFile(pending);
  }, []);

  const mono = (extra = "") =>
    cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  function pickFile(f: File | undefined) {
    if (!f) return;
    if (!ACCEPT_EXTENSIONS.includes(extOf(f.name))) {
      setError(t("errorFileType"));
      return;
    }
    if (f.size > MAX_FILE_BYTES) {
      setError(t("errorTooLarge"));
      return;
    }
    setError(null);
    setFile(f);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (!email.trim() && !phone.trim()) {
      setError(t("errorContact"));
      return;
    }
    if (!technique) {
      setError(t("errorTechnique"));
      return;
    }

    setLoading(true);
    try {
      // Upload the file straight from the browser to Storage (up to 50 MB,
      // bypassing Vercel's request-body limit). Best-effort: if it fails, we
      // still capture the lead and ask the visitor to send the file separately.
      let storagePath: string | null = null;
      if (file) {
        try {
          const supabase = createClient();
          const path = `${crypto.randomUUID()}/${sanitize(file.name)}`;
          const { error: upErr } = await supabase.storage
            .from(QUOTE_BUCKET)
            .upload(path, file, { upsert: false });
          if (!upErr) storagePath = path;
        } catch {
          storagePath = null;
        }
      }

      const res = await fetch("/api/design-quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locale,
          email: email.trim(),
          phone: phone.trim(),
          name: name.trim(),
          technique,
          message: message.trim(),
          file_name: file?.name ?? "",
          file_size: file?.size ?? 0,
          storage_path: storagePath,
        }),
      });
      if (!res.ok) {
        setError(t("errorGeneric"));
        setLoading(false);
        return;
      }
      // "sent" = file safely stored; "sent_large" = had a file but upload
      // failed (ask them to send it another way); "sent_nofile" = no file.
      setDone(!file ? "sent_nofile" : storagePath ? "sent" : "sent_large");
    } catch {
      setError(t("errorGeneric"));
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="neu mt-8 p-8 text-center sm:p-10">
        <CheckCircle2 className="mx-auto h-12 w-12 text-cobalt" strokeWidth={1.5} />
        <h2 className="mt-4 text-xl font-bold text-heading">{t("successTitle")}</h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-mutedtext">
          {done === "sent_large"
            ? t("successLargeFile", { file: file?.name ?? "" })
            : done === "sent_nofile"
              ? t("successNoFile")
              : t("successBody")}
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Button
            type="button"
            variant="outline"
            className="rounded-full"
            onClick={() => {
              setFile(null);
              setEmail("");
              setPhone("");
              setName("");
              setTechnique("");
              setMessage("");
              setDone(null);
            }}
          >
            {t("newRequest")}
          </Button>
          <Button asChild variant="ghost" className="rounded-full">
            <Link href="/">{t("backHome")}</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="neu mt-8 space-y-6 p-6 sm:p-8">
      {/* File */}
      <div className="space-y-2">
        <span className={mono("block text-[10px] text-mutedtext")}>{t("fileLabel")}</span>
        {file ? (
          <div className="flex items-center gap-3 rounded-xl bg-panel px-3 py-2.5 shadow-neu-sm">
            <FileBox className="h-4 w-4 shrink-0 text-cobalt" />
            <span className="flex-1 truncate text-sm text-body" dir="ltr">
              {file.name}
            </span>
            <span className="shrink-0 text-[11px] tabular-nums text-faint">
              {(file.size / 1024 / 1024).toFixed(2)} MB
            </span>
            <button
              type="button"
              onClick={() => setFile(null)}
              aria-label={t("fileChange")}
              className="shrink-0 text-mutedtext hover:text-destructive"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="neu-inset flex w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-xl px-4 py-8 text-center transition hover:text-cobalt"
          >
            <UploadCloud className="h-7 w-7 text-cobalt" strokeWidth={1.5} />
            <span className="text-sm font-medium text-heading">{t("fileBrowse")}</span>
            <span className="text-[11px] text-faint">{t("fileHint")}</span>
          </button>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT_ATTR}
          onChange={(e) => {
            pickFile(e.target.files?.[0]);
            e.target.value = "";
          }}
          className="sr-only"
        />
      </div>

      {/* Contact */}
      <div className="space-y-2">
        <span className={mono("block text-[10px] text-mutedtext")}>{t("contactLabel")}</span>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t("emailPlaceholder")}
            aria-label={t("emailLabel")}
            className={fieldClass}
            dir="ltr"
          />
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder={t("phonePlaceholder")}
            aria-label={t("phoneLabel")}
            className={fieldClass}
            dir="ltr"
          />
        </div>
        <p className="text-[11px] text-faint">{t("contactHint")}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* Name */}
        <div className="space-y-2">
          <label htmlFor="q-name" className={mono("block text-[10px] text-mutedtext")}>
            {t("nameLabel")} <span className="lowercase text-faint">({t("nameOptional")})</span>
          </label>
          <input
            id="q-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("namePlaceholder")}
            className={fieldClass}
          />
        </div>

        {/* Technique */}
        <div className="space-y-2">
          <label htmlFor="q-technique" className={mono("block text-[10px] text-mutedtext")}>
            {t("techniqueLabel")}
          </label>
          <select
            id="q-technique"
            value={technique}
            onChange={(e) => setTechnique(e.target.value)}
            className={cn(fieldClass, isRtl && "text-right")}
          >
            <option value="" disabled>
              {t("techniquePlaceholder")}
            </option>
            {TECHNIQUES.map((m) => (
              <option key={m} value={m}>
                {t(`technique_${m}`)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Notes */}
      <div className="space-y-2">
        <label htmlFor="q-message" className={mono("block text-[10px] text-mutedtext")}>
          {t("messageLabel")} <span className="lowercase text-faint">({t("messageOptional")})</span>
        </label>
        <textarea
          id="q-message"
          rows={3}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={t("messagePlaceholder")}
          className={cn(fieldClass, "resize-y")}
        />
      </div>

      {error && <p className="text-sm font-medium text-destructive">{error}</p>}

      <Button type="submit" disabled={loading} size="lg" className="rounded-full">
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        {loading ? t("sending") : t("submit")}
      </Button>
    </form>
  );
}
