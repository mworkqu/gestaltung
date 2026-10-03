"use client";

// "Send test to me": renders one notification kind with sample data and emails
// it to the signed-in admin only. Nothing is written to the outbox.

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Send } from "lucide-react";

import { cn } from "@/lib/utils";

const field =
  "rounded-lg border border-white/60 bg-surface px-2.5 py-1.5 text-sm text-heading shadow-neu-inset outline-none focus:ring-2 focus:ring-cobalt/60";

export function NotificationTestForm({ kinds, defaultLocale }: { kinds: string[]; defaultLocale: "en" | "ar" }) {
  const t = useTranslations("Notifications");
  const [kind, setKind] = useState(kinds[0] ?? "");
  const [locale, setLocale] = useState<"en" | "ar">(defaultLocale);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const send = async () => {
    setBusy(true);
    setResult(null);
    const res = await fetch("/api/admin/notifications/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, locale }),
    }).catch(() => null);
    const data = res ? ((await res.json().catch(() => null)) as { ok?: boolean; to?: string; error?: string } | null) : null;
    setBusy(false);
    if (data?.ok) {
      setResult({ ok: true, text: t("testSent", { email: data.to ?? "" }) });
    } else {
      const code = data?.error ?? "network";
      const known = ["forbidden", "bad_request", "no_email", "not_configured", "send_failed"];
      setResult({ ok: false, text: t(`testErr_${known.includes(code) ? code : "failed"}`) });
    }
  };

  return (
    <section className="neu space-y-3 p-4">
      <div>
        <h2 className="text-sm font-bold text-heading">{t("testTitle")}</h2>
        <p className="text-[12px] text-mutedtext">{t("testHint")}</p>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-[11px] text-mutedtext">
          {t("testKind")}
          <select value={kind} onChange={(e) => setKind(e.target.value)} className={field}>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {t(`kind_${k as "first_project"}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-mutedtext">
          {t("testLocale")}
          <select value={locale} onChange={(e) => setLocale(e.target.value === "ar" ? "ar" : "en")} className={field}>
            <option value="en">English</option>
            <option value="ar">العربية</option>
          </select>
        </label>
        <button
          type="button"
          onClick={send}
          disabled={busy || !kind}
          className="inline-flex items-center gap-1.5 rounded-lg bg-cobalt px-3 py-1.5 text-xs font-semibold text-white hover:bg-cobalt-hover disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Send className="h-3.5 w-3.5" aria-hidden />}
          {t("testButton")}
        </button>
      </div>
      {result && (
        <p role="status" className={cn("text-sm font-medium", result.ok ? "text-emerald-700" : "text-destructive")}>
          {result.text}
        </p>
      )}
    </section>
  );
}
