"use client";

// Asks for a WhatsApp number only where it is needed (P1-11 / CC-1): when the
// parts list first appears ("bom"), when a guest saves their project link
// ("save-link", with an optional email), or before a quote ("quote"). An inline
// card, not a modal. Saved to profiles.phone, so it is never asked twice; the
// parent decides visibility with shouldShowPhonePrompt (lib/projects/phone-prompt.ts).
// "Not now" hides the card in this browser (localStorage), except on
// "save-link", where it only closes the panel.

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Check, Loader2 } from "lucide-react";

import { PrimaryButton } from "@/components/prototyping/ui";
import { track } from "@/lib/analytics";
import { loadSupabase } from "@/lib/supabase/lazy";
import { isValidPhone, normalizePhone } from "@/lib/phone";
import { phonePromptDismissKey } from "@/lib/projects/phone-prompt";
import { isPlausibleEmail } from "@/lib/store/shipping";
import { cn } from "@/lib/utils";

export type PhonePromptVariant = "bom" | "save-link" | "quote";

const PROMPT_KEY: Record<PhonePromptVariant, string> = {
  bom: "phonePromptBom",
  "save-link": "phonePromptSaveLink",
  quote: "phonePromptQuote",
};

const field =
  "w-full min-h-[44px] rounded-xl border border-white/60 bg-panel px-3 py-2 text-sm text-heading shadow-neu-inset outline-none placeholder:text-faint focus:ring-2 focus:ring-cobalt/60";

export function PhonePrompt({
  userId,
  variant,
  onSaved,
  withEmail = false,
  projectId,
  existingPhone,
  onDismiss,
  onEmailSent,
  className,
}: {
  userId: string;
  variant: PhonePromptVariant;
  /** Called with the normalised phone once it is on the profile. */
  onSaved: (phone: string) => void;
  /** Adds the optional email that sends the project link (save-link). */
  withEmail?: boolean;
  /** Needed with `withEmail`. */
  projectId?: string;
  /** A phone already on the profile: the phone field is skipped. */
  existingPhone?: string | null;
  onDismiss?: () => void;
  /** The project link email went out. */
  onEmailSent?: () => void;
  className?: string;
}) {
  const t = useTranslations("Projects");
  const locale = useLocale();
  const askPhone = !existingPhone;
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  function notNow() {
    if (variant !== "save-link") {
      try {
        localStorage.setItem(phonePromptDismissKey(userId), "1");
      } catch {
        // Storage blocked: hidden for this visit only.
      }
    }
    onDismiss?.();
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const typedEmail = withEmail ? email.trim() : "";
    if (askPhone && !isValidPhone(phone)) return setError(t("phoneRequired"));
    if (typedEmail && !isPlausibleEmail(typedEmail)) return setError(t("emailInvalid"));
    if (!askPhone && !typedEmail) return setError(t("emailInvalid"));
    setError(null);
    setBusy(true);

    if (askPhone) {
      const normalised = normalizePhone(phone);
      const { error: saveError } = await (await loadSupabase()).from("profiles").update({ phone: normalised }).eq("id", userId);
      if (saveError) {
        setError(t("saveFailed"));
        setBusy(false);
        return;
      }
      track("phone_captured", { where: variant });
      onSaved(normalised);
    }

    if (typedEmail && projectId) {
      const res = await fetch("/api/projects/recovery-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, email: typedEmail, locale }),
      })
        .then((r) => r.json() as Promise<{ sent?: boolean }>)
        .catch(() => ({ sent: false }));
      setBusy(false);
      if (!res.sent) return setError(t("saveLinkFailed"));
      setDone(t("saveLinkSent", { email: typedEmail }));
      onEmailSent?.();
      return;
    }

    setBusy(false);
    setDone(t("phoneSaved"));
  }

  if (done) {
    return (
      <p className={cn("neu-inset flex items-center gap-2 p-4 text-sm font-medium text-buy", className)} role="status">
        <Check className="h-4 w-4 shrink-0" />
        {done}
      </p>
    );
  }

  return (
    <form onSubmit={submit} className={cn("neu-inset space-y-3 p-4", className)}>
      <div className="space-y-1">
        <p className="text-sm font-semibold text-heading">{t(PROMPT_KEY[variant])}</p>
        <p className="text-[12px] text-mutedtext">{withEmail ? t("saveLinkHint") : t("explainWhy")}</p>
      </div>

      {askPhone && (
        <label className="block space-y-1">
          <span className="text-[11px] font-semibold text-mutedtext">{t("drawingPhoneLabel")}</span>
          <input
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+974 5XXX XXXX"
            dir="ltr"
            className={field}
          />
        </label>
      )}

      {withEmail && (
        <label className="block space-y-1">
          <span className="text-[11px] font-semibold text-mutedtext">{t("emailLabel")}</span>
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@example.com"
            dir="ltr"
            className={field}
          />
          <span className="block text-[11px] text-mutedtext">{t("emailHint")}</span>
        </label>
      )}

      {error && <p className="text-[12px] font-medium text-destructive">{error}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <PrimaryButton type="submit" disabled={busy} className="min-h-[44px] sm:min-h-0">
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {t("phoneSave")}
        </PrimaryButton>
        <button
          type="button"
          onClick={notNow}
          className="min-h-[44px] text-[12px] font-semibold text-mutedtext hover:text-heading sm:min-h-0"
        >
          {t("phoneNotNow")}
        </button>
      </div>
    </form>
  );
}
