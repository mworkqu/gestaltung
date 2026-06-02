"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";

const fieldClass =
  "w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-heading placeholder:text-faint focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export function ContactForm() {
  const t = useTranslations("Contact");
  const [submitted, setSubmitted] = useState(false);

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
      <div className="rounded-lg border border-azure/40 bg-azure/10 p-6 text-sm text-body">
        {t("success")}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="name" className="text-sm font-medium text-body">
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

      <div className="space-y-1.5">
        <label htmlFor="email" className="text-sm font-medium text-body">
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

      <div className="space-y-1.5">
        <label htmlFor="message" className="text-sm font-medium text-body">
          {t("messageLabel")}
        </label>
        <textarea
          id="message"
          name="message"
          required
          rows={5}
          placeholder={t("messagePlaceholder")}
          className={`${fieldClass} resize-y`}
        />
      </div>

      <Button type="submit" className="w-full sm:w-auto">
        {t("submit")}
      </Button>
    </form>
  );
}
