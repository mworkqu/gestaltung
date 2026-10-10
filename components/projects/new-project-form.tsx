"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CheckCircle2, FileText, Loader2, UploadCloud, X } from "lucide-react";

import { Link, useRouter } from "@/i18n/navigation";
import { track } from "@/lib/analytics";
import { createClient } from "@/lib/supabase/client";
import { ensureSession, getCurrentUser, isGuest } from "@/lib/supabase/guest";
import { isValidPhone, normalizePhone } from "@/lib/phone";
import { isPlausibleEmail } from "@/lib/store/shipping";
import { Button } from "@/components/ui/button";
import { Turnstile, turnstileActive } from "@/components/turnstile";
import { PROJECT_IMAGE_BUCKET, DRAWING_ATTACHMENT_ACCEPT } from "@/lib/projects/constants";
import { attachmentExt, checkDrawingAttachment } from "@/lib/projects/drawing-attachment";
import { formatQar } from "@/lib/pricing/plans";
import type { DrawingTier, DrawingTierId } from "@/lib/pricing/service-tiers";
import { cn } from "@/lib/utils";

// Starting a project is the one thing that must never hit a sign-in wall. The
// anonymous session is minted here, at the first write — not on page load — so
// a visitor who only browses never costs an MAU.
//
// `forDrawing` (audit #11, "help me draw it"): the same project, plus what to
// draw and a WhatsApp number; the owner is told so the drawing can be quoted.
//
// Optional email (owner decision D6, migration 0045): after the project is
// created, /api/projects/recovery-email sends a link with a secret key that
// opens (moves) this guest project in any other browser. Only offered to
// visitors without an account — an account already works on every device.
//
// Turnstile (P2-08): with the switch on and no session yet, the widget's token
// goes to ensureSession() (anonymous sign-in); without one the page's challenge
// dialog is asked. Switch off = no widget, ensureSession() exactly as before.
export function NewProjectForm({
  forDrawing = false,
  turnstileEnabled = false,
  tiers = [],
}: {
  forDrawing?: boolean;
  turnstileEnabled?: boolean;
  /** Drawing tiers from service_prices (drawing request only). */
  tiers?: DrawingTier[];
}) {
  const t = useTranslations("Projects");
  const locale = useLocale();
  const router = useRouter();

  const [name, setName] = useState("");
  const [brief, setBrief] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  // True once we know the visitor is signed in with a real account.
  const [isAccount, setIsAccount] = useState(false);
  // A visitor without an account gives a WhatsApp number instead (owner,
  // 2026-09-29: "a phone number is enough"). It's saved on their profile, so
  // the project has a way to reach them. Signed-in accounts skip it.
  const [needsPhone, setNeedsPhone] = useState(true);
  const [needsCheck, setNeedsCheck] = useState(false);
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);
  useEffect(() => {
    const supabase = createClient();
    getCurrentUser().then(async (user) => {
      if (!user) {
        setNeedsCheck(turnstileActive(turnstileEnabled));
        return;
      }
      if (!isGuest(user)) {
        setIsAccount(true);
        return setNeedsPhone(false);
      }
      const { data: prof } = await supabase.from("profiles").select("phone").eq("id", user.id).maybeSingle();
      if (prof?.phone) setNeedsPhone(false);
    });
  }, [turnstileEnabled]);
  const askPhone = needsPhone || forDrawing;
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Drawing request: optional size tier + one photo / sketch / PDF.
  const [tier, setTier] = useState<DrawingTierId | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // After a drawing request is sent: the confirmation screen replaces the form.
  const [done, setDone] = useState<{ id: string; fileFailed: boolean } | null>(null);

  function pickFile(f: File | undefined) {
    if (!f) return;
    const verdict = checkDrawingAttachment(f);
    if (verdict !== "ok") {
      setFileError(t(verdict === "type" ? "drawingFileType" : "drawingFileTooLarge"));
      return;
    }
    setFileError(null);
    setFile(f);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t("nameRequired"));
      return;
    }
    if (forDrawing && !brief.trim()) {
      setError(t("drawingRequired"));
      return;
    }
    if (askPhone && !isValidPhone(phone)) {
      setError(t("phoneRequired"));
      return;
    }
    const contactEmail = isAccount ? "" : email.trim();
    if (contactEmail && !isPlausibleEmail(contactEmail)) {
      setError(t("emailInvalid"));
      return;
    }

    setError(null);
    setLoading(true);

    try {
      let user: Awaited<ReturnType<typeof ensureSession>>;
      try {
        user = await ensureSession({ captchaToken: captcha });
      } finally {
        // Single-use token: a retry needs a fresh one.
        if (captcha) setCaptchaReset((k) => k + 1);
      }
      const supabase = createClient();
      const { data, error: insertError } = await supabase
        .from("projects")
        .insert({ user_id: user.id, name: trimmed, ...(forDrawing ? { brief: brief.trim() } : {}) })
        .select("id")
        .single();

      if (insertError) throw insertError;
      track("project_created", { method: forDrawing ? "drawing" : "form" });

      if (askPhone && isGuest(user)) {
        // Best-effort: the project exists either way.
        await supabase.from("profiles").update({ phone: normalizePhone(phone) }).eq("id", user.id);
      }

      if (contactEmail && isGuest(user)) {
        // Best-effort: emails the project link (needs 0045; skipped before).
        await fetch("/api/projects/recovery-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: data.id, email: contactEmail, locale }),
        }).catch(() => {});
      }

      let fileFailed = false;
      if (forDrawing && file) {
        // Same bucket, path and RLS as project images (<user_id>/<project_id>/…).
        const ext = attachmentExt(file.name) || "bin";
        const path = `${user.id}/${data.id}/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage.from(PROJECT_IMAGE_BUCKET).upload(path, file);
        if (upErr) {
          fileFailed = true;
        } else {
          const { error: blockErr } = await supabase
            .from("project_blocks")
            .insert({ project_id: data.id, type: "image", storage_path: path, position: 0 });
          if (blockErr) fileFailed = true;
        }
      }

      if (forDrawing) {
        const picked = tiers.find((x) => x.id === tier);
        const sizeLine = picked ? `\n\nSize: ${picked.id} (${picked.from ? "from " : ""}QAR ${picked.price})` : "";
        const fileLine = file
          ? fileFailed
            ? "\n\nPhoto/sketch: upload FAILED, ask the client to send it."
            : "\n\nPhoto/sketch: attached to the project."
          : "";
        // Best-effort: the project exists either way.
        await fetch("/api/store-lead", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            source: "drawing_request",
            name: trimmed,
            phone: phone.trim(),
            ...(contactEmail ? { email: contactEmail } : {}),
            locale,
            message: `Drawing request for project "${trimmed}" (${data.id}).

${brief.trim()}${sizeLine}${fileLine}`,
          }),
        }).catch(() => {});
      }

      if (forDrawing) {
        // Confirmation screen instead of the raw project page. refresh() so the
        // server sees the session cookie the anonymous sign-in just wrote.
        setDone({ id: data.id as string, fileFailed });
        setLoading(false);
        router.refresh();
        return;
      }
      // refresh() so the server sees the session cookie the anonymous sign-in
      // just wrote, before the workspace renders.
      router.push(`/projects/${data.id}`);
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : (err as { message?: string })?.message ?? String(err);
      // 0042: the database refuses a 4th active project.
      setError(message.includes("project_limit") ? t("limitReached") : message);
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="neu space-y-4 p-8 text-center sm:p-10" role="status">
        <CheckCircle2 className="mx-auto h-12 w-12 text-cobalt" strokeWidth={1.5} aria-hidden />
        <h2 className="text-xl font-bold text-heading">{t("drawingDoneTitle")}</h2>
        <p className="mx-auto max-w-md text-base leading-relaxed text-body">{t("drawingDoneBody")}</p>
        {done.fileFailed && <p className="text-sm font-medium text-destructive">{t("drawingFileFailed")}</p>}
        <Button asChild size="lg" className="rounded-full">
          <Link href={`/projects/${done.id}`}>{t("drawingDoneLink")}</Link>
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="neu space-y-5 p-6 sm:p-8">
      <div className="space-y-2">
        <label htmlFor="project-name" className="block text-sm font-medium text-heading">
          {t("nameLabel")}
        </label>
        <input
          id="project-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("namePlaceholder")}
          autoFocus
          className="w-full rounded-xl border border-white/60 bg-panel px-4 py-3 text-base text-heading shadow-neu-inset outline-none placeholder:text-faint focus:ring-2 focus:ring-cobalt/60"
        />
      </div>

      {forDrawing && (
        <>
          <div className="space-y-2">
            <label htmlFor="project-brief" className="block text-sm font-medium text-heading">
              {t("drawingBriefLabel")}
            </label>
            <textarea
              id="project-brief"
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              rows={5}
              placeholder={t("drawingBriefPlaceholder")}
              className="w-full rounded-xl border border-white/60 bg-panel px-4 py-3 text-base text-heading shadow-neu-inset outline-none placeholder:text-faint focus:ring-2 focus:ring-cobalt/60"
            />
          </div>

          {tiers.length > 0 && (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-heading">
                {t("drawingTierLabel")} <span className="text-faint">({t("drawingTierOptional")})</span>
              </legend>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {tiers.map((x) => (
                  <label
                    key={x.id}
                    className={cn(
                      "flex min-h-11 cursor-pointer flex-col justify-center rounded-xl bg-panel px-4 py-3 shadow-neu-sm transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-cobalt/60",
                      tier === x.id && "ring-2 ring-cobalt",
                    )}
                  >
                    <input
                      type="radio"
                      name="drawing-tier"
                      value={x.id}
                      checked={tier === x.id}
                      onChange={() => setTier(x.id)}
                      onClick={() => tier === x.id && setTier(null)}
                      className="sr-only"
                    />
                    <span className="text-sm font-semibold text-heading">
                      {t(x.id === "simple" ? "drawingTierSimple" : x.id === "assembly" ? "drawingTierAssembly" : "drawingTierComplex")}
                    </span>
                    <span className="text-sm text-cobalt">
                      {t(x.from ? "drawingTierPriceFrom" : "drawingTierPrice", { price: formatQar(x.price) })}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          <div className="space-y-2">
            <span className="block text-sm font-medium text-heading">
              {t("drawingFileLabel")} <span className="text-faint">({t("drawingFileOptional")})</span>
            </span>
            {file ? (
              <div className="flex items-center gap-3 rounded-xl bg-panel px-3 py-2.5 shadow-neu-sm">
                <FileText className="h-4 w-4 shrink-0 text-cobalt" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-sm text-body" dir="ltr">
                  {file.name}
                </span>
                <button
                  type="button"
                  onClick={() => setFile(null)}
                  aria-label={t("drawingFileRemove")}
                  className="grid h-11 w-11 shrink-0 place-items-center text-mutedtext hover:text-destructive"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="neu-inset flex min-h-11 w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-xl px-4 py-6 text-center transition hover:text-cobalt"
              >
                <UploadCloud className="h-7 w-7 text-cobalt" strokeWidth={1.5} aria-hidden />
                <span className="text-sm font-medium text-heading">{t("drawingFileChoose")}</span>
                <span className="text-[11px] text-faint">{t("drawingFileHint")}</span>
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept={DRAWING_ATTACHMENT_ACCEPT}
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
        </>
      )}

      {askPhone && (
        <div className="space-y-2">
          <label htmlFor="project-phone" className="block text-sm font-medium text-heading">
            {t("drawingPhoneLabel")}
          </label>
          <input
            id="project-phone"
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+974 5XXX XXXX"
            dir="ltr"
            className="w-full rounded-xl border border-white/60 bg-panel px-4 py-3 text-base text-heading shadow-neu-inset outline-none placeholder:text-faint focus:ring-2 focus:ring-cobalt/60"
          />
          <p className="text-[11px] text-mutedtext">{t(forDrawing ? "drawingPhoneHint" : "phoneHint")}</p>
        </div>
      )}

      {!isAccount && (
        <div className="space-y-2">
          <label htmlFor="project-email" className="block text-sm font-medium text-heading">
            {t("emailLabel")}
          </label>
          <input
            id="project-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@example.com"
            dir="ltr"
            className="w-full rounded-xl border border-white/60 bg-panel px-4 py-3 text-base text-heading shadow-neu-inset outline-none placeholder:text-faint focus:ring-2 focus:ring-cobalt/60"
          />
          <p className="text-[11px] text-mutedtext">{t("emailHint")}</p>
        </div>
      )}

      {needsCheck && (
        <Turnstile enabled={turnstileEnabled} onToken={setCaptcha} resetKey={captchaReset} action="new_project" />
      )}

      {error && <p className="text-sm font-medium text-destructive">{error}</p>}

      <Button type="submit" size="lg" disabled={loading} className="w-full sm:w-auto">
        {loading ? (
          <>
            <Loader2 className="me-2 h-4 w-4 animate-spin" />
            {t("creating")}
          </>
        ) : (
          t(forDrawing ? "drawingSubmit" : "create")
        )}
      </Button>
    </form>
  );
}
