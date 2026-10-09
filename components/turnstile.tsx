"use client";

// Cloudflare Turnstile widget (P2-08). Renders NOTHING unless `enabled` (the
// store_settings switch, passed from a server page — never fetched here) and
// NEXT_PUBLIC_TURNSTILE_SITE_KEY are both set, so with the switch off the page
// is exactly as before: no script, no element, no request to Cloudflare.
//
// When on: loads api.js lazily on mount (once per page), renders one widget
// (size "flexible", the page's language), mirrors the token into a hidden
// `cf-turnstile-response` input and calls onToken(token | null). If the script
// has not loaded after 8 s it shows a fallback with Retry and the WhatsApp
// link. Tokens are single-use: bump `resetKey` after every submit that used
// one (successful or not) to get a fresh token.

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Loader2, RotateCcw } from "lucide-react";

import { COMPANY_WHATSAPP } from "@/lib/company";
import { TURNSTILE_FIELD, TURNSTILE_SCRIPT } from "@/lib/turnstile";
import { cn } from "@/lib/utils";

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string | undefined;
  reset: (id?: string) => void;
  remove: (id: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const LOAD_TIMEOUT_MS = 8000;
let scriptPromise: Promise<TurnstileApi> | null = null;

/** Loads api.js once per page; a failed or timed-out load can be retried. */
function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = TURNSTILE_SCRIPT;
    script.async = true;
    script.defer = true;
    const fail = (why: string) => {
      clearTimeout(timer);
      script.remove();
      scriptPromise = null;
      reject(new Error(why));
    };
    const timer = setTimeout(() => fail("timeout"), LOAD_TIMEOUT_MS);
    script.onload = () => {
      clearTimeout(timer);
      if (window.turnstile) resolve(window.turnstile);
      else fail("no_api");
    };
    script.onerror = () => fail("load_error");
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export type TurnstileProps = {
  /** The store_settings switch from the server page. */
  enabled: boolean;
  onToken?: (token: string | null) => void;
  /** Change it (e.g. counter + 1) to discard the used token and get a new one. */
  resetKey?: number;
  /** Cloudflare analytics label, e.g. "sign_in" (letters, digits, _ and -). */
  action?: string;
  className?: string;
};

/** True when a widget would render: the switch and a site key. Use it to decide whether a token is required. */
export function turnstileActive(enabled: boolean): boolean {
  return enabled && !!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
}

export function Turnstile({ enabled, onToken, resetKey = 0, action, className }: TurnstileProps) {
  const t = useTranslations("Turnstile");
  const locale = useLocale();
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const on = enabled && !!siteKey;

  const box = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const onTokenRef = useRef(onToken);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [token, setToken] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);

  useEffect(() => {
    if (!on || !box.current) return;
    let cancelled = false;
    const el = box.current;
    setStatus("loading");
    loadTurnstile()
      .then((api) => {
        if (cancelled) return;
        const emit = (value: string | null) => {
          setToken(value ?? "");
          onTokenRef.current?.(value);
        };
        widgetId.current =
          api.render(el, {
            sitekey: siteKey,
            size: "flexible",
            theme: "light",
            language: locale === "ar" ? "ar" : "en",
            ...(action ? { action } : {}),
            // We render our own hidden input (below) so there is exactly one.
            "response-field": false,
            callback: (value: string) => emit(value),
            "expired-callback": () => emit(null),
            "timeout-callback": () => emit(null),
            "error-callback": () => {
              emit(null);
              // Turnstile shows its own error state and retries; nothing to add.
              return true;
            },
          }) ?? null;
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("failed");
      });
    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetId.current);
        } catch {
          // Already gone.
        }
      }
      widgetId.current = null;
    };
  }, [on, siteKey, locale, action, attempt]);

  // A used token is dead: reset the widget so it issues a new one.
  const firstReset = useRef(true);
  useEffect(() => {
    if (firstReset.current) {
      firstReset.current = false;
      return;
    }
    setToken("");
    onTokenRef.current?.(null);
    if (widgetId.current && window.turnstile) {
      try {
        window.turnstile.reset(widgetId.current);
      } catch {
        // Widget removed meanwhile; the next mount renders a fresh one.
      }
    }
  }, [resetKey]);

  if (!on) return null;

  return (
    <div className={cn("space-y-2", className)}>
      <input type="hidden" name={TURNSTILE_FIELD} value={token} />
      <div ref={box} className={cn("min-h-[65px] w-full", status === "failed" && "hidden")} />
      {status === "loading" && (
        <p className="flex items-center gap-2 text-[12px] text-mutedtext" aria-live="polite">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          {t("loading")}
        </p>
      )}
      {status === "failed" && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-start text-sm text-amber-900"
        >
          <span className="min-w-0 flex-1">
            {t.rich("failed", {
              wa: (chunks) => (
                <a
                  href={COMPANY_WHATSAPP.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold underline underline-offset-2"
                >
                  {chunks}
                </a>
              ),
            })}
          </span>
          <button
            type="button"
            onClick={() => setAttempt((a) => a + 1)}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-surface px-4 text-sm font-semibold text-heading shadow-neu-sm md:min-h-9"
          >
            <RotateCcw className="h-4 w-4" aria-hidden />
            {t("retry")}
          </button>
        </div>
      )}
    </div>
  );
}
