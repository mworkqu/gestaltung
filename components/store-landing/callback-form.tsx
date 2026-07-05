"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CheckCircle2, Loader2, MessageCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Homepage lead capture, neu style. Collects a name + number and tells the
// visitor we'll contact them; POSTs to /api/store-lead which saves the lead
// (inquiries table) and emails info@gestaltung360.com.
const fieldClass =
  "w-full rounded-xl border border-white/60 bg-panel px-4 py-3 text-sm text-heading shadow-neu-inset outline-none transition placeholder:text-faint focus:ring-2 focus:ring-cobalt/60";

export function HomeCallback() {
  const t = useTranslations("StoreLanding");
  const locale = useLocale();
  const isRtl = locale === "ar";
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mono = (extra = "") =>
    cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

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

  return (
    <section className="neu animate-fade-up delay-3 grid gap-8 p-8 sm:p-10 md:grid-cols-2 md:items-center">
      <div className="space-y-3">
        <span className="inline-flex w-fit items-center gap-2 rounded-full bg-panel px-3 py-1.5 shadow-neu-sm">
          <span className="h-2 w-2 rounded-full bg-[#25d366]" />
          <span className={mono("text-[10px] text-mutedtext")}>{t("footerCta")}</span>
        </span>
        <h2 className="text-2xl font-extrabold tracking-tight text-heading sm:text-3xl">
          {t("callbackPrompt")}
        </h2>
      </div>

      {done ? (
        <div className="neu-inset flex items-start gap-4 p-6">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-cobalt shadow-neu-sm">
            <CheckCircle2 className="h-6 w-6 text-white" strokeWidth={1.5} />
          </span>
          <p className="text-sm leading-relaxed text-body">{t("callbackDone")}</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <input name="name" placeholder={t("callbackName")} className={fieldClass} />
            <input
              name="phone"
              inputMode="tel"
              dir="ltr"
              placeholder={t("callbackPhone")}
              className={cn(fieldClass, isRtl && "text-right")}
            />
          </div>
          {error && <p className="text-sm font-medium text-destructive">{error}</p>}
          <Button type="submit" size="lg" disabled={loading} className="w-full rounded-full sm:w-auto sm:px-8">
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <MessageCircle className="h-4 w-4" />
            )}
            {t("callbackSubmit")}
          </Button>
        </form>
      )}
    </section>
  );
}
