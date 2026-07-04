"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CheckCircle2, Loader2, MessageCircle } from "lucide-react";

// Footer lead capture on the store landing. Instead of opening WhatsApp, it
// collects the visitor's name + number and tells them we'll contact them. On
// submit it POSTs to /api/store-lead, which saves the lead (inquiries table)
// and emails info@gestaltung360.com. Styled with the landing's --sl-* tokens.
export function CallbackForm() {
  const t = useTranslations("StoreLanding");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const phone = String(form.get("phone") ?? "").trim();
    if (!name || !phone) {
      setError(t("callbackError"));
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/store-lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone, locale }),
      });
      if (!res.ok) throw new Error("bad status");
      setDone(true);
    } catch {
      setError(t("callbackError"));
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="flex items-start gap-3 self-start rounded-[10px] border border-[var(--sl-wa-border)] bg-[var(--sl-wa-bg)] px-[18px] py-[13px] text-sm text-[var(--sl-wa)]">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} />
        <span className="max-w-[240px] leading-relaxed">{t("callbackDone")}</span>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-[9px] self-start rounded-[10px] border border-[var(--sl-wa-border)] bg-[var(--sl-wa-bg)] px-[18px] py-[11px] text-sm font-medium text-[var(--sl-wa)]"
      >
        <MessageCircle className="h-4 w-4" strokeWidth={2} />
        {t("footerCta")}
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="w-full max-w-[320px] space-y-2.5 self-start"
    >
      <p className="text-[13px] leading-relaxed text-[var(--sl-body)]">
        {t("callbackPrompt")}
      </p>
      <input
        name="name"
        required
        placeholder={t("callbackName")}
        className="w-full rounded-lg border border-[var(--sl-search-border)] bg-[var(--sl-search-bg)] px-3.5 py-2.5 text-sm text-[var(--sl-heading)] outline-none placeholder:text-[var(--sl-faint)] focus:border-[var(--sl-accent)]"
      />
      <input
        name="phone"
        required
        inputMode="tel"
        dir="ltr"
        placeholder={t("callbackPhone")}
        className="w-full rounded-lg border border-[var(--sl-search-border)] bg-[var(--sl-search-bg)] px-3.5 py-2.5 text-sm text-[var(--sl-heading)] outline-none placeholder:text-[var(--sl-faint)] focus:border-[var(--sl-accent)] ltr:text-left rtl:text-right"
      />
      {error && (
        <p className="text-[12px] font-medium text-[var(--sl-err)]">{error}</p>
      )}
      <button
        type="submit"
        disabled={loading}
        className="flex w-full items-center justify-center gap-2 rounded-[10px] border border-[var(--sl-wa-border)] bg-[var(--sl-wa-bg)] px-[18px] py-[11px] text-sm font-medium text-[var(--sl-wa)] disabled:opacity-60"
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <MessageCircle className="h-4 w-4" strokeWidth={2} />
        )}
        {t("callbackSubmit")}
      </button>
    </form>
  );
}
