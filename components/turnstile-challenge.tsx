"use client";

// On-demand Turnstile dialog (P2-08). Pages whose buttons can mint an anonymous
// session without a form of their own (add to cart, add to project, the
// emailed-link claim gate) render <TurnstileChallenge enabled={…} /> once. With
// the switch on and a site key it registers with lib/turnstile-client.ts, and
// ensureSession() opens this dialog for a token only when it really has to
// sign someone in. With the switch off it renders nothing and registers
// nothing, so ensureSession() behaves exactly as before.

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";

import { Turnstile, turnstileActive } from "@/components/turnstile";
import { registerTurnstileRequester } from "@/lib/turnstile-client";

type Pending = { resolve: (token: string) => void; reject: (e: Error) => void };

export function TurnstileChallenge({ enabled }: { enabled: boolean }) {
  const t = useTranslations("Turnstile");
  const on = turnstileActive(enabled);
  const [open, setOpen] = useState(false);
  const pending = useRef<Pending | null>(null);

  useEffect(() => {
    if (!on) return;
    const unregister = registerTurnstileRequester(
      () =>
        new Promise<string>((resolve, reject) => {
          pending.current?.reject(new Error("captcha_cancelled"));
          pending.current = { resolve, reject };
          setOpen(true);
        })
    );
    return () => {
      unregister();
      pending.current?.reject(new Error("captcha_cancelled"));
      pending.current = null;
    };
  }, [on]);

  function cancel() {
    pending.current?.reject(new Error("captcha_cancelled"));
    pending.current = null;
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      pending.current?.reject(new Error("captcha_cancelled"));
      pending.current = null;
      setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!on || !open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-ink/40 p-4" onClick={cancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="turnstile-challenge-title"
        className="neu w-full max-w-sm space-y-4 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 id="turnstile-challenge-title" className="text-base font-bold text-heading">
              {t("challengeTitle")}
            </h2>
            <p className="text-[13px] leading-relaxed text-mutedtext">{t("challengeIntro")}</p>
          </div>
          <button
            type="button"
            onClick={cancel}
            aria-label={t("cancel")}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-mutedtext hover:text-heading md:h-9 md:w-9"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <Turnstile
          enabled={enabled}
          action="guest_session"
          onToken={(token) => {
            if (!token || !pending.current) return;
            pending.current.resolve(token);
            pending.current = null;
            setOpen(false);
          }}
        />
      </div>
    </div>
  );
}
