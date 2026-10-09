"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { CheckCircle2, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PhoneInput } from "@/components/phone-input";
import { Turnstile, turnstileActive } from "@/components/turnstile";
import { cn } from "@/lib/utils";
import { isValidPhone } from "@/lib/phone";

// Recessed "well" inputs. Uses the shadow-neu-inset utility (not the .neu-inset
// component class) so the cobalt focus ring composes with the inset shadow via
// Tailwind's box-shadow chain instead of overwriting it.
const fieldClass =
  "w-full rounded-xl border border-white/60 bg-panel px-4 py-3 text-sm text-heading shadow-neu-inset transition placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-cobalt/60";

type ContactKind = "school" | "institution";

// turnstileEnabled (P2-08): the store_settings switch from the server page.
// Off (default) = no widget, no token, the same POST as before.
export function ContactForm({ turnstileEnabled = false }: { turnstileEnabled?: boolean }) {
  const t = useTranslations("Contact");
  const tPhone = useTranslations("Phone");
  const tCheck = useTranslations("Turnstile");
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);
  const locale = useLocale();
  const isRtl = locale === "ar";
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // /contact?kind=school (from /students) or ?kind=institution (from /pricing): the message
  // starts with a prefix and the lead is tagged. Read in an effect, not from searchParams,
  // so the page stays static.
  const kindRef = useRef<ContactKind | null>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let kind: string | null = null;
    try {
      kind = new URLSearchParams(window.location.search).get("kind");
    } catch {
      return;
    }
    if (kind !== "school" && kind !== "institution") return;
    kindRef.current = kind;
    const box = messageRef.current;
    if (box && !box.value) box.value = kind === "school" ? t("schoolPrefill") : t("institutionPrefill");
  }, [t]);

  // English gets the monospace / uppercase Swiss treatment; Arabic stays clean.
  const mono = (extra = "") =>
    cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const data = new FormData(e.currentTarget);
    const form = e.currentTarget;
    if (!isValidPhone(String(data.get("phone") ?? ""))) {
      setError(tPhone("invalid"));
      setLoading(false);
      return;
    }
    if (turnstileActive(turnstileEnabled) && !captcha) {
      setError(tCheck("required"));
      setLoading(false);
      return;
    }
    const payload = {
      name: String(data.get("name")).trim(),
      phone: String(data.get("phone")).trim(), // WhatsApp — primary contact
      email: String(data.get("email") ?? "").trim(), // optional
      message: String(data.get("message")).trim(),
      locale,
      source: "contact_form",
      ...(kindRef.current ? { kind: kindRef.current } : {}),
      ...(captcha ? { turnstileToken: captcha } : {}),
    };

    try {
      // Routes through /api/store-lead: saves the inquiry AND emails
      // info@gestaltung360.com (server-side, where the Resend key lives).
      const res = await fetch("/api/store-lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.status === 403) {
        setError(tCheck("captchaFailed"));
        return;
      }
      if (!res.ok) throw new Error("bad status");
      setSubmitted(true);
      form.reset();
    } catch {
      setError(t("errorSubmit"));
    } finally {
      setLoading(false);
      // The token is single-use: get a fresh one for any next attempt.
      if (captcha) setCaptchaReset((k) => k + 1);
    }
  }

  if (submitted) {
    return (
      <div className="neu-inset flex items-start gap-4 p-6">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-cobalt shadow-neu-sm">
          <CheckCircle2 className="h-6 w-6 text-white" strokeWidth={1.5} />
        </span>
        <p className="text-sm leading-relaxed text-body">{t("success")}</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="space-y-2">
        <label htmlFor="name" className={mono("block text-[10px] text-mutedtext")}>
          {t("nameLabel")}
        </label>
        <input
          id="name"
          name="name"
          type="text"
          required
          placeholder={t("namePlaceholder")}
          className={fieldClass}
        />
      </div>

      {/* WhatsApp is the primary contact channel — required. */}
      <div className="space-y-2">
        <label htmlFor="phone" className={mono("block text-[10px] text-mutedtext")}>
          {t("whatsappLabel")}
        </label>
        <PhoneInput
          id="phone"
          name="phone"
          placeholder={t("whatsappPlaceholder")}
          codeAriaLabel={t("countryCode")}
        />
        <p className="text-[11px] leading-snug text-faint">{t("whatsappNote")}</p>
      </div>

      <div className="space-y-2">
        <label htmlFor="email" className={mono("block text-[10px] text-mutedtext")}>
          {t("emailOptional")}
        </label>
        <input
          id="email"
          name="email"
          type="email"
          dir="ltr"
          placeholder={t("emailPlaceholder")}
          className={cn(fieldClass, isRtl && "text-right")}
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="message" className={mono("block text-[10px] text-mutedtext")}>
          {t("messageLabel")}
        </label>
        <textarea
          id="message"
          name="message"
          ref={messageRef}
          required
          rows={5}
          placeholder={t("messagePlaceholder")}
          className={cn(fieldClass, "resize-y")}
        />
      </div>

      <Turnstile enabled={turnstileEnabled} onToken={setCaptcha} resetKey={captchaReset} action="contact" />

      {error && <p className="text-sm font-medium text-destructive">{error}</p>}

      <Button
        type="submit"
        size="lg"
        disabled={loading}
        className="w-full rounded-full sm:w-auto sm:px-8"
      >
        {loading && <Loader2 className="animate-spin" />}
        {t("submit")}
      </Button>
    </form>
  );
}
