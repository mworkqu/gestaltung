"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Loader2, UploadCloud, FileBox, X, CheckCircle2 } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { track } from "@/lib/analytics";
import { createClient } from "@/lib/supabase/client";
import { ensureSession, getCurrentUser } from "@/lib/supabase/guest";
import { Turnstile, turnstileActive } from "@/components/turnstile";
import { takePendingUpload } from "@/lib/design/pending-upload";
import {
  ACCEPT_ATTR,
  ACCEPT_EXTENSIONS,
  CAD_BUCKET,
  EXT_ALIASES,
  MAX_FILE_BYTES,
  QUOTE_BUCKET,
} from "@/lib/design/constants";
import { cn } from "@/lib/utils";
import { isValidPhone } from "@/lib/phone";
import { DEFAULT_QUOTE_METHOD, QUOTE_METHODS } from "@/lib/design/quote-method";


const fieldClass =
  "w-full rounded-xl border border-white/60 bg-panel px-4 py-3 text-sm text-heading shadow-neu-inset transition placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-cobalt/60";

function extOf(name: string) {
  return name.split(".").pop()?.toLowerCase() ?? "";
}
function sanitize(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

type Done = "sent" | "sent_large" | "sent_nofile" | null;

// turnstileEnabled (P2-08): with the switch on and no session yet, the widget's
// token goes to ensureSession() (anonymous sign-in for the project). If that
// still fails the request falls back to the plain quote upload, as before — the
// lead is never lost. Switch off = no widget, exactly as before.
export function QuoteRequest({
  turnstileEnabled = false,
  edmFrom,
}: {
  turnstileEnabled?: boolean;
  /** service_prices.edm_from, already formatted (the price is data, never typed here). */
  edmFrom: string;
}) {
  const t = useTranslations("DesignQuote");
  const tPhone = useTranslations("Phone");
  const locale = useLocale();
  const isRtl = locale === "ar";
  const inputRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [technique, setTechnique] = useState<string>(DEFAULT_QUOTE_METHOD);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Field-level errors, shown under the field they belong to. A failed check
  // never clears what was typed.
  const [fileError, setFileError] = useState<string | null>(null);
  const [contactError, setContactError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState<Done>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [needsCheck, setNeedsCheck] = useState(false);
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);
  useEffect(() => {
    if (!turnstileActive(turnstileEnabled)) return;
    void getCurrentUser().then((u) => setNeedsCheck(!u));
  }, [turnstileEnabled]);

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
      setFileError(t("errorFileType"));
      return;
    }
    if (f.size > MAX_FILE_BYTES) {
      setFileError(t("errorTooLarge"));
      return;
    }
    setFileError(null);
    setError(null);
    setFile(f);
  }

  // Email or phone, at least one. Returns the message to show, or null.
  function contactProblem(nextEmail: string, nextPhone: string): string | null {
    if (!nextEmail.trim() && !nextPhone.trim()) return t("errorContact");
    if (nextPhone.trim() && !isValidPhone(nextPhone)) return tPhone("invalid");
    return null;
  }

  // Checked when a contact field loses focus, unless focus is only moving to
  // the other contact field (the visitor is still filling them in).
  function onContactBlur(e: React.FocusEvent<HTMLInputElement>) {
    const to = e.relatedTarget as Node | null;
    if (to && (to === emailRef.current || to === phoneRef.current)) return;
    setContactError(contactProblem(email, phone));
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    // The file and the method are optional; only a way to reach you is required.
    const cErr = contactProblem(email, phone);
    setContactError(cErr);
    if (cErr) {
      (!email.trim() && phone.trim() ? phoneRef : emailRef).current?.focus();
      return;
    }

    setLoading(true);
    try {
      // Upload the file straight from the browser to Storage (up to 50 MB,
      // bypassing Vercel's request-body limit). Best-effort: if it fails, we
      // still capture the lead and ask the visitor to send the file separately.
      // Project spine (audit #11, owner decision 2a): the request becomes a
      // project with the file attached, so the customer can follow it up and
      // it sits beside everything else they make. If that fails we fall back
      // to the plain quote upload — the lead is never lost.
      let storagePath: string | null = null;
      let bucket: "cad" | "quote" = "quote";
      let newProject: string | null = null;
      try {
        let user: Awaited<ReturnType<typeof ensureSession>>;
        try {
          user = await ensureSession({ captchaToken: captcha });
        } finally {
          // Single-use token: a retry needs a fresh one.
          if (captcha) setCaptchaReset((k) => k + 1);
        }
        const supabase = createClient();
        const title = (file?.name.replace(/\.[^.]+$/, "") || name.trim() || t("projectDefaultName")).slice(0, 120);
        const { data: proj, error: projErr } = await supabase
          .from("projects")
          .insert({ user_id: user.id, name: title, brief: message.trim() || null })
          .select("id")
          .single();
        if (projErr) throw projErr;
        newProject = proj.id as string;
        track("project_created", { method: "quote" });
        const ext = file ? EXT_ALIASES[extOf(file.name)] : undefined;
        if (file && ext) {
          const path = `${user.id}/${newProject}/${crypto.randomUUID()}-${sanitize(file.name)}`;
          const { error: upErr } = await supabase.storage.from(CAD_BUCKET).upload(path, file);
          if (!upErr) {
            await supabase.from("project_files").insert({
              project_id: newProject,
              storage_path: path,
              file_name: file.name,
              file_ext: ext,
              size_bytes: file.size,
            });
            storagePath = path;
            bucket = "cad";
          }
        }
      } catch {
        newProject = null;
      }
      if (file && !storagePath) {
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
          bucket,
          project_id: newProject,
        }),
      });
      if (!res.ok) {
        setError(t("errorGeneric"));
        setLoading(false);
        return;
      }
      // "sent" = file safely stored; "sent_large" = had a file but upload
      // failed (ask them to send it another way); "sent_nofile" = no file.
      setProjectId(newProject);
      if (phone.trim()) track("phone_captured", { where: "quote" });
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
              setTechnique(DEFAULT_QUOTE_METHOD);
              setMessage("");
              setDone(null);
            }}
          >
            {t("newRequest")}
          </Button>
          {projectId && (
            <Button asChild className="rounded-full">
              <Link href={`/projects/${projectId}`}>{t("openProject")}</Link>
            </Button>
          )}
          <Button asChild variant="ghost" className="rounded-full">
            <Link href="/">{t("backHome")}</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="neu mt-8 space-y-6 p-6 sm:p-8">
      <p className="text-[11px] text-faint">{t("requiredNote")}</p>

      {/* File (optional) */}
      <div className="space-y-2">
        <span className={mono("block text-[10px] text-mutedtext")}>
          {t("fileLabel")} <span className="lowercase text-faint">({t("fileOptional")})</span>
        </span>
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
        {fileError && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {fileError}
          </p>
        )}
      </div>

      {/* Contact */}
      <div className="space-y-2">
        <span className={mono("block text-[10px] text-mutedtext")}>
          {t("contactLabel")} <span aria-hidden className="text-destructive">*</span>
        </span>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <input
            ref={emailRef}
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (contactError) setContactError(contactProblem(e.target.value, phone));
            }}
            onBlur={onContactBlur}
            placeholder={t("emailPlaceholder")}
            aria-label={t("emailLabel")}
            aria-invalid={contactError ? true : undefined}
            aria-describedby="q-contact-msg"
            className={fieldClass}
            dir="ltr"
          />
          <input
            ref={phoneRef}
            type="tel"
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
              if (contactError) setContactError(contactProblem(email, e.target.value));
            }}
            onBlur={onContactBlur}
            placeholder={t("phonePlaceholder")}
            aria-label={t("phoneLabel")}
            aria-invalid={contactError ? true : undefined}
            aria-describedby="q-contact-msg"
            className={fieldClass}
            dir="ltr"
          />
        </div>
        {contactError ? (
          <p id="q-contact-msg" role="alert" className="text-sm font-medium text-destructive">
            {contactError}
          </p>
        ) : (
          <p id="q-contact-msg" className="text-[11px] text-faint">
            {t("contactHint")}
          </p>
        )}
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

        {/* Method (optional, defaults to "not sure") */}
        <div className="space-y-2">
          <label htmlFor="q-technique" className={mono("block text-[10px] text-mutedtext")}>
            {t("techniqueLabel")} <span className="lowercase text-faint">({t("techniqueOptional")})</span>
          </label>
          <select
            id="q-technique"
            value={technique}
            onChange={(e) => setTechnique(e.target.value)}
            className={cn(fieldClass, "min-h-11", isRtl && "text-right")}
          >
            {QUOTE_METHODS.map((m) => (
              <option key={m} value={m}>
                {m === "edm" ? t("technique_edm_from", { price: edmFrom }) : t(`technique_${m}`)}
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

      {needsCheck && (
        <Turnstile enabled={turnstileEnabled} onToken={setCaptcha} resetKey={captchaReset} action="quote" />
      )}

      {error && <p className="text-sm font-medium text-destructive">{error}</p>}

      <Button type="submit" disabled={loading} size="lg" className="rounded-full">
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        {loading ? t("sending") : t("submit")}
      </Button>
    </form>
  );
}
