"use client";

import { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { CheckCircle2 } from "lucide-react";

import { Button } from "@/components/ui/button";
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

  // English gets the monospace / uppercase Swiss treatment; Arabic stays clean.
  const mono = (extra = "") =>
    cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    // No backend yet (Stage 4+). For now, log the submission.
    console.log("Contact form submission:", {
      name: data.get("name"),
      email: data.get("email"),
      message: data.get("message"),
    });
    setSubmitted(true);
    e.currentTarget.reset();
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

      <div className="space-y-2">
        <label htmlFor="email" className={mono("block text-[10px] text-mutedtext")}>
          {t("emailLabel")}
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          placeholder={t("emailPlaceholder")}
          className={fieldClass}
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

      <Button type="submit" size="lg" className="w-full rounded-full sm:w-auto sm:px-8">
        {t("submit")}
      </Button>
    </form>
  );
}
