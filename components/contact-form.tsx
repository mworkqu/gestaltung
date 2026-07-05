"use client";

import { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { CheckCircle2, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PhoneInput } from "@/components/phone-input";
import { cn } from "@/lib/utils";

// Recessed "well" inputs. Uses the shadow-neu-inset utility (not the .neu-inset
// component class) so the cobalt focus ring composes with the inset shadow via
// Tailwind's box-shadow chain instead of overwriting it.
const fieldClass =
  "w-full rounded-xl border border-white/60 bg-panel px-4 py-3 text-sm text-heading shadow-neu-inset transition placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-cobalt/60";

export function ContactForm() {
  const t = useTranslations("Contact");
  const locale = useLocale();
  const isRtl = locale === "ar";
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // English gets the monospace / uppercase Swiss treatment; Arabic stays clean.
  const mono = (extra = "") =>
    cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const data = new FormData(e.currentTarget);
    const form = e.currentTarget;
    const payload = {
      name: String(data.get("name")).trim(),
      phone: String(data.get("phone")).trim(), // WhatsApp — primary contact
      email: String(data.get("email") ?? "").trim(), // optional
      message: String(data.get("message")).trim(),
      locale,
      source: "contact_form",
    };

    try {
      // Routes through /api/store-lead: saves the inquiry AND emails
      // info@gestaltung360.com (server-side, where the Resend key lives).
      const res = await fetch("/api/store-lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("bad status");
      setSubmitted(true);
      form.reset();
    } catch {
      setError(t("errorSubmit"));
    } finally {
      setLoading(false);
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
          required
          rows={5}
          placeholder={t("messagePlaceholder")}
          className={cn(fieldClass, "resize-y")}
        />
      </div>

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
