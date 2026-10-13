"use client";

// W2 (2026-10-11): the ONE "Get it made" entry point of the Design Studio,
// shown from the Enclosure step onward: a bottom bar on phones, a sticky
// footer on wider screens. It replaces the old "Request printing" (Print step)
// and "Get it made" (Make step) buttons and sends the same lead
// (StudioApi.requestQuote → /api/store-lead, source studio_quote).
//
// The pop-up is a native <dialog> (showModal: real focus trap, Escape, inert
// page behind, focus back to the button) and follows the page direction.
// It asks ONLY what we don't know: name / WhatsApp number / email come from
// the profile and are shown as one line with "Change"; the note is optional.
// A guest is asked to sign up / sign in first (W1 keeps their project); the
// return path carries ?getItMade=1 so the pop-up opens again on return.

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Factory, Loader2, X } from "lucide-react";

import { AuthReturnLink } from "@/components/auth/auth-return-link";
import { formatPhoneDisplay, isValidPhone, normalizePhone } from "@/lib/phone";
import { isPlausibleEmail } from "@/lib/store/shipping";
import { track } from "@/lib/analytics";
import { useStudioLibrary } from "./StudioLibraryProvider";
import type { Locale, PrintFile, Profile, StudioApi } from "@/lib/studio/client/api";
import type { StudioDoc } from "@/lib/studio/schema";
import { groupComponents, withQuantity } from "@/lib/studio/parts-group";
import { cn } from "@/lib/utils";

/** Query flag on the sign-in return path: open the pop-up again on arrival. */
export const GET_IT_MADE_PARAM = "getItMade";

const field =
  "w-full rounded-xl border border-white/60 bg-panel px-3 py-2.5 text-base text-heading shadow-neu-inset placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-cobalt/60 sm:text-sm";

type Phase = "loading" | "guest" | "form" | "sending";

export function GetItMade({
  api,
  doc,
  locale,
  autoOpen = false,
  productFiles,
  beforeLeave,
  onSent,
}: {
  api: StudioApi;
  doc: StudioDoc;
  locale: Locale;
  /** Open once on mount (back from sign-in with ?getItMade=1). */
  autoOpen?: boolean;
  /** P5-16: the unlocked product's STLs (every printed body), uploaded with the request. */
  productFiles?: () => Promise<PrintFile[]>;
  /** Save pending edits before the visitor leaves for the sign-in page. */
  beforeLeave: () => void;
  /** The lead went out: the shell records it on the doc and opens the quote page. */
  onSent: () => Promise<void> | void;
}) {
  const t = useTranslations("StudioRequest");
  const tS = useTranslations("Studio");
  const { getPart } = useStudioLibrary();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const introId = useId();

  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("loading");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<{ name?: string; phone?: string; email?: string }>({});
  const [failed, setFailed] = useState(false);

  // What the profile already answers (a stored number must still pass today's rule).
  const knownName = profile?.fullName?.trim() || "";
  const knownPhone = profile?.phone && isValidPhone(profile.phone) ? profile.phone : "";
  const knownEmail = profile?.email && isPlausibleEmail(profile.email) ? profile.email : "";
  const askName = editing || !knownName;
  const askPhone = editing || !knownPhone;
  const askEmail = editing || !knownEmail;
  const hasKnown = !editing && !!(knownName || knownPhone || knownEmail);

  const load = useCallback(async () => {
    setPhase("loading");
    setFailed(false);
    setErrors({});
    const p = await api.profile().catch((): Profile => ({ userId: null, phone: null, fullName: null, guest: true }));
    setProfile(p);
    if (!p.userId || p.guest) {
      setPhase("guest");
      return;
    }
    setName(p.fullName?.trim() ?? "");
    setPhone(p.phone && isValidPhone(p.phone) ? formatPhoneDisplay(p.phone) : "");
    setEmail(p.email ?? "");
    setEditing(false);
    setPhase("form");
  }, [api]);

  const openDialog = useCallback(() => {
    setOpen(true);
    void load();
  }, [load]);

  // Native modal: showModal / close follow `open`.
  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const [autoOpened, setAutoOpened] = useState(false);
  useEffect(() => {
    if (!autoOpen || autoOpened) return;
    setAutoOpened(true);
    openDialog();
  }, [autoOpen, autoOpened, openDialog]);

  function close() {
    if (phase === "sending") return;
    setOpen(false);
  }

  /** Before the sign-in page: mark the return path so the pop-up reopens there. */
  function markReturn() {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set(GET_IT_MADE_PARAM, "1");
      window.history.replaceState(window.history.state, "", url.toString());
    } catch {
      /* the visitor reopens it by hand */
    }
    beforeLeave();
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const finalName = (askName ? name : knownName).trim();
    const finalPhone = askPhone ? phone.trim() : knownPhone;
    const finalEmail = (askEmail ? email : knownEmail).trim();
    const next: typeof errors = {};
    if (!finalName) next.name = t("nameRequired");
    if (!isValidPhone(finalPhone)) next.phone = t("phoneInvalid");
    if (finalEmail && !isPlausibleEmail(finalEmail)) next.email = t("emailInvalid");
    setErrors(next);
    if (Object.keys(next).length) {
      const first = next.name ? "gim-name" : next.phone ? "gim-phone" : "gim-email";
      dialogRef.current?.querySelector<HTMLElement>(`[data-field="${first}"]`)?.focus();
      return;
    }
    setFailed(false);
    setPhase("sending");
    const phoneE164 = normalizePhone(finalPhone);
    // Part D: identical parts once, with the count ("Strong metal-gear servo (MG996R) × 3").
    const items = groupComponents(doc.components.filter((c) => !c.auto)).map((g) =>
      withQuantity(getPart(g.partId)?.name.en ?? g.first.label, g.quantity),
    );
    // An unlocked product: every printed body's STL goes with the request (best-effort, never blocks it).
    let files: string[] = [];
    if (productFiles) {
      try {
        files = await api.uploadPrintFiles(await productFiles());
      } catch {
        files = [];
      }
    }
    const ok = await api
      .requestQuote({
        name: finalName || tS("defaultContactName"),
        phone: phoneE164,
        email: finalEmail || undefined,
        note: note.trim() || undefined,
        items: items.length ? items : [doc.spec.name],
        locale,
        designName: doc.spec.name,
        ...(files.length ? { files } : {}),
      })
      .catch(() => false);
    if (!ok) {
      setPhase("form");
      setFailed(true);
      return;
    }
    if (askPhone) track("phone_captured", { where: "quote" });
    // Never ask again: keep what was typed on the profile (best-effort).
    await api
      .saveContact({
        ...(askName && finalName !== knownName ? { fullName: finalName } : {}),
        ...(askPhone && phoneE164 !== knownPhone ? { phone: phoneE164 } : {}),
      })
      .catch(() => {});
    await onSent();
  }

  const busy = phase === "sending";

  return (
    <>
      <div
        data-testid="studio-get-it-made-bar"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-white/70 bg-[#eef2f7]/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-8px_24px_-16px_rgba(15,23,42,0.35)] backdrop-blur sm:sticky sm:bottom-4 sm:mx-auto sm:rounded-[24px] sm:border sm:px-5 sm:py-3 sm:shadow-neu-sm"
      >
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
          <p className="hidden text-sm text-body sm:block">{t("barText")}</p>
          <button
            ref={triggerRef}
            type="button"
            onClick={openDialog}
            aria-haspopup="dialog"
            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-heading px-7 py-3 text-sm font-semibold text-white transition-[background-color,transform] hover:bg-heading/90 active:scale-[0.98] sm:w-auto"
          >
            <Factory className="h-4 w-4" strokeWidth={1.75} aria-hidden />
            {tS("getMade")}
          </button>
        </div>
      </div>

      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        aria-describedby={introId}
        data-testid="studio-get-it-made"
        onCancel={(e) => {
          // Escape: close through our state (and never mid-send).
          e.preventDefault();
          close();
        }}
        onClose={() => {
          setOpen(false);
          triggerRef.current?.focus();
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
        className="m-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-y-auto rounded-t-[28px] bg-surface p-0 text-heading shadow-neu backdrop:bg-black/40 sm:m-auto sm:max-w-lg sm:rounded-[28px]"
      >
        {open && (
          <div className="space-y-4 p-5 sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <h2 id={titleId} className="text-lg font-extrabold tracking-tight">
                {tS("getMade")}
              </h2>
              <button
                type="button"
                onClick={close}
                disabled={busy}
                aria-label={tS("close")}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-mutedtext hover:text-heading disabled:opacity-50"
              >
                <X className="h-4 w-4" strokeWidth={1.75} />
              </button>
            </div>
            <p id={introId} className="text-sm leading-relaxed text-mutedtext">
              {phase === "guest" ? t("guestText") : t("dialogIntro")}
            </p>

            {phase === "loading" && (
              <p role="status" className="flex items-center gap-2 text-sm text-mutedtext">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                {t("loading")}
              </p>
            )}

            {phase === "guest" && (
              <div className="space-y-3" data-testid="studio-get-it-made-guest">
                <p className="text-base font-semibold">{t("guestTitle")}</p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <AuthReturnLink
                    kind="sign-up"
                    onClick={markReturn}
                    className="inline-flex min-h-12 flex-1 items-center justify-center rounded-full bg-cobalt px-6 text-sm font-semibold text-white hover:bg-cobalt-hover"
                  >
                    {t("signUp")}
                  </AuthReturnLink>
                  <AuthReturnLink
                    kind="sign-in"
                    onClick={markReturn}
                    className="inline-flex min-h-12 flex-1 items-center justify-center rounded-full px-6 text-sm font-semibold text-cobalt shadow-neu-sm hover:text-cobalt-hover"
                  >
                    {t("signIn")}
                  </AuthReturnLink>
                </div>
              </div>
            )}

            {(phase === "form" || phase === "sending") && (
              <form onSubmit={(e) => void submit(e)} noValidate className="space-y-3">
                {hasKnown && (
                  <div className="tile flex items-start justify-between gap-3 p-4" data-testid="studio-get-it-made-known">
                    <div className="min-w-0 space-y-0.5 text-sm">
                      <p className="text-xs font-semibold text-mutedtext">{t("knownTitle")}</p>
                      {knownName && <p className="truncate font-semibold">{knownName}</p>}
                      {knownPhone && (
                        <p dir="ltr" className="text-start font-mono">
                          {formatPhoneDisplay(knownPhone)}
                        </p>
                      )}
                      {knownEmail && (
                        <p dir="ltr" className="truncate text-start">
                          {knownEmail}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => setEditing(true)}
                      className="inline-flex min-h-11 shrink-0 items-center rounded-full px-3 text-sm font-semibold text-cobalt hover:text-cobalt-hover"
                    >
                      {t("change")}
                    </button>
                  </div>
                )}

                {askName && (
                  <Field id="gim-name" label={t("nameLabel")} error={errors.name}>
                    <input
                      id="gim-name"
                      data-field="gim-name"
                      autoComplete="name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder={t("namePlaceholder")}
                      aria-invalid={!!errors.name}
                      aria-describedby={errors.name ? "gim-name-err" : undefined}
                      maxLength={120}
                      className={field}
                    />
                  </Field>
                )}
                {askPhone && (
                  <Field id="gim-phone" label={t("phoneLabel")} hint={t("phoneHint")} error={errors.phone}>
                    <input
                      id="gim-phone"
                      data-field="gim-phone"
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      dir="ltr"
                      value={phone}
                      onChange={(e) => {
                        setPhone(e.target.value);
                        if (errors.phone && isValidPhone(e.target.value)) setErrors((x) => ({ ...x, phone: undefined }));
                      }}
                      onBlur={() => {
                        if (phone.trim() && !isValidPhone(phone)) setErrors((x) => ({ ...x, phone: t("phoneInvalid") }));
                      }}
                      placeholder={t("phonePlaceholder")}
                      aria-invalid={!!errors.phone}
                      aria-describedby={errors.phone ? "gim-phone-err" : "gim-phone-hint"}
                      maxLength={24}
                      className={cn(field, "text-start")}
                    />
                  </Field>
                )}
                {askEmail && (
                  <Field id="gim-email" label={t("emailLabel")} error={errors.email}>
                    <input
                      id="gim-email"
                      data-field="gim-email"
                      type="email"
                      autoComplete="email"
                      dir="ltr"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder={t("emailPlaceholder")}
                      aria-invalid={!!errors.email}
                      aria-describedby={errors.email ? "gim-email-err" : undefined}
                      maxLength={160}
                      className={cn(field, "text-start")}
                    />
                  </Field>
                )}
                <Field id="gim-note" label={t("noteLabel")}>
                  <textarea
                    id="gim-note"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder={t("notePlaceholder")}
                    rows={3}
                    maxLength={1000}
                    className={cn(field, "resize-y")}
                  />
                </Field>

                {failed && (
                  <p role="alert" className="text-sm font-medium text-destructive">
                    {tS("requestFailed")}
                  </p>
                )}
                <button
                  type="submit"
                  disabled={busy}
                  className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-cobalt px-7 py-3 text-sm font-semibold text-white shadow-[0_8px_20px_-8px_rgba(14,89,197,0.7)] transition-[background-color,transform] hover:bg-cobalt-hover active:scale-[0.98] disabled:opacity-60"
                >
                  {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                  {busy ? t("sending") : t("send")}
                </button>
              </form>
            )}
          </div>
        )}
      </dialog>
    </>
  );
}

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-xs font-semibold text-mutedtext">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-err`} role="alert" className="text-xs font-medium text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-mutedtext">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
