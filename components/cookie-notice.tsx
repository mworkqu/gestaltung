"use client";

// Cookie notice + analytics gate (owner decision D7).
//
// - GA4 is NOT in the page. This component adds the gtag script only after the
//   visitor pressed Accept (this visit or a remembered earlier one). Before
//   that, and after Decline, nothing is requested from Google at all.
// - The choice is read on the client only (localStorage + a first-party
//   cookie), so the server render is identical for everyone and the page stays
//   cacheable. The first render and the server HTML contain nothing from this
//   component; the bar appears after hydration.
// - It is position: fixed, so showing it moves nothing (no layout shift). An
//   in-flow spacer of the same height sits at the end of the page on phones, so
//   the last content (the checkout button included) can always be scrolled
//   above the bar.

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import {
  CONSENT_COOKIE,
  CONSENT_STORAGE_KEY,
  consentCookie,
  gaCommands,
  gtagSrc,
  readCookie,
  resolveConsent,
  serializeConsent,
  shouldLoadAnalytics,
  type ConsentChoice,
} from "@/lib/analytics/consent";

type GtagWindow = Window & { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void };

const SCRIPT_ID = "ga-gtag";

function readStoredConsent(): ConsentChoice | null {
  let local: string | null = null;
  try {
    local = window.localStorage.getItem(CONSENT_STORAGE_KEY);
  } catch {
    // Storage blocked: the cookie may still be there.
  }
  return resolveConsent({ local, cookie: readCookie(document.cookie, CONSENT_COOKIE) }, Date.now());
}

function storeConsent(choice: ConsentChoice) {
  const now = Date.now();
  try {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, serializeConsent(choice, now));
  } catch {
    // Ignore: the cookie below is the fallback.
  }
  document.cookie = consentCookie(choice, now, window.location.protocol === "https:");
}

/** Add gtag.js once, with Google Signals and ad personalisation switched off. */
function loadGa(gaId: string) {
  if (document.getElementById(SCRIPT_ID)) return;
  const w = window as GtagWindow;
  w.dataLayer = w.dataLayer || [];
  // gtag.js reads the dataLayer entries as `arguments` objects, not arrays.
  w.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params
    w.dataLayer!.push(arguments);
  };
  for (const [cmd, ...rest] of gaCommands(gaId, new Date())) w.gtag(cmd, ...rest);
  const s = document.createElement("script");
  s.id = SCRIPT_ID;
  s.async = true;
  s.src = gtagSrc(gaId);
  document.head.appendChild(s);
}

export function CookieNotice({ gaId }: { gaId?: string }) {
  const t = useTranslations("CookieNotice");
  // undefined = storage not read yet (server render and first client render).
  const [choice, setChoice] = useState<ConsentChoice | null | undefined>(undefined);
  const barRef = useRef<HTMLDivElement>(null);
  const [barHeight, setBarHeight] = useState(0);

  useEffect(() => {
    setChoice(readStoredConsent());
  }, []);

  useEffect(() => {
    if (gaId && shouldLoadAnalytics(choice ?? null, gaId)) loadGa(gaId);
  }, [choice, gaId]);

  const visible = choice === null;

  // Keep the spacer exactly as tall as the bar (it wraps to more lines on narrow screens).
  useEffect(() => {
    const el = barRef.current;
    if (!visible || !el) {
      setBarHeight(0);
      return;
    }
    const measure = () => setBarHeight(el.offsetHeight);
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [visible]);

  function decide(next: ConsentChoice) {
    storeConsent(next);
    setChoice(next);
  }

  if (!visible) return null;

  return (
    <>
      <div
        ref={barRef}
        role="region"
        aria-label={t("label")}
        className="fixed inset-x-0 bottom-0 z-20 border-t border-borderstrong/60 bg-surface/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-6px_18px_rgba(163,177,198,0.35)] backdrop-blur"
      >
        <div className="container flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
          <p className="text-sm text-body">
            {t("text")}{" "}
            <Link href="/privacy" className="whitespace-nowrap font-medium text-cobalt underline underline-offset-2 hover:text-cobalt-hover">
              {t("privacy")}
            </Link>
          </p>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => decide("declined")}
              className="inline-flex min-h-11 flex-1 items-center justify-center rounded-lg border border-borderstrong bg-surface px-5 text-sm font-semibold text-heading transition-colors hover:bg-panel sm:flex-none"
            >
              {t("decline")}
            </button>
            <button
              type="button"
              onClick={() => decide("accepted")}
              className="inline-flex min-h-11 flex-1 items-center justify-center rounded-lg bg-cobalt px-5 text-sm font-semibold text-white transition-colors hover:bg-cobalt-hover sm:flex-none"
            >
              {t("accept")}
            </button>
          </div>
        </div>
      </div>
      {/* Phones only: from sm up the bar is one thin row, and a spacer on a short
          page would add a scrollbar (a shift) for no benefit. */}
      <div aria-hidden className="sm:hidden" style={{ height: barHeight }} />
    </>
  );
}
