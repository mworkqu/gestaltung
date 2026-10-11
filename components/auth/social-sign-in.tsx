"use client";

// "Continue with Google / Apple / Microsoft" above the email form (2026-10-11).
//
// Renders NOTHING when no provider is enabled in Supabase (the page passes
// the list from lib/auth/providers-server.ts), so the forms look exactly as
// before. A provider error from /api/auth/callback (?oauth_error=<id>) shows
// one plain line even when the list is empty.
//
// Guests keep their work: when the current session is anonymous we call
// linkIdentity, so the SAME user id becomes a real account and the projects,
// cart and credits stay where they are. If linking cannot start (manual
// linking off) we fall back to a plain signInWithOAuth; if the provider
// account already has a user, /api/auth/callback starts the plain sign-in
// itself and moves the guest's work with claim_guest_work (migration 0071).

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { afterAuthPath } from "@/lib/auth/next-path";
import {
  PROVIDER_LABEL,
  oauthCallbackUrl,
  oauthScopes,
  type OAuthProvider,
} from "@/lib/auth/providers";
import { cn } from "@/lib/utils";

export function SocialSignIn({
  providers,
  next = null,
  errorProvider = null,
}: {
  providers: OAuthProvider[];
  /** Already-validated "/{locale}/…" path to return to; null = the dashboard. */
  next?: string | null;
  /** The provider that failed on the way back, from ?oauth_error=. */
  errorProvider?: OAuthProvider | null;
}) {
  const t = useTranslations("Auth");
  const locale = useLocale();
  const [busy, setBusy] = useState<OAuthProvider | null>(null);
  const [failed, setFailed] = useState<OAuthProvider | null>(errorProvider);

  if (providers.length === 0 && !failed) return null;

  async function start(provider: OAuthProvider) {
    setBusy(provider);
    setFailed(null);
    const supabase = createClient();
    const target = afterAuthPath(next, locale);
    const origin = window.location.origin;
    const scopes = oauthScopes(provider);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (session?.user?.is_anonymous) {
        const { error } = await supabase.auth.linkIdentity({
          provider,
          options: { redirectTo: oauthCallbackUrl(origin, target, provider, { link: true }), scopes },
        });
        if (!error) return; // the browser is on its way to the provider
        // Linking could not start (e.g. manual linking is off): sign in instead;
        // the callback moves the guest's work to that account.
      }

      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: oauthCallbackUrl(origin, target, provider), scopes },
      });
      if (error) throw error;
    } catch {
      setFailed(provider);
      setBusy(null);
    }
  }

  return (
    <div className="mb-6 space-y-3">
      {providers.map((provider) => (
        <button
          key={provider}
          type="button"
          onClick={() => void start(provider)}
          disabled={busy !== null}
          aria-busy={busy === provider}
          data-testid={`oauth-${provider}`}
          className={cn(
            "flex h-11 min-h-11 w-full items-center justify-center gap-3 rounded-full border border-borderstrong bg-white px-5",
            "text-sm font-semibold text-heading shadow-neu-sm transition active:scale-[0.98]",
            "hover:bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-cobalt/60 disabled:opacity-70"
          )}
        >
          {busy === provider ? (
            <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden />
          ) : (
            <ProviderMark provider={provider} />
          )}
          <span>{t("continueWith", { provider: PROVIDER_LABEL[provider] })}</span>
        </button>
      ))}

      {failed && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {t("oauthError", { provider: PROVIDER_LABEL[failed] })}
        </p>
      )}

      {providers.length > 0 && (
        <div className="flex items-center gap-3 pt-2" aria-hidden>
          <span className="h-px flex-1 bg-borderstrong" />
          <span className="text-xs text-mutedtext">{t("orDivider")}</span>
          <span className="h-px flex-1 bg-borderstrong" />
        </div>
      )}
    </div>
  );
}

// Simple monochrome marks (currentColor), no external assets.
function ProviderMark({ provider }: { provider: OAuthProvider }) {
  const common = { className: "h-5 w-5 shrink-0", viewBox: "0 0 24 24", fill: "currentColor", "aria-hidden": true } as const;
  if (provider === "google") {
    return (
      <svg {...common}>
        <path d="M21.35 11.1H12v2.98h5.35c-.23 1.25-.94 2.3-2 3.01v2.5h3.23c1.89-1.74 2.98-4.3 2.98-7.34 0-.72-.06-1.42-.21-2.15ZM12 22c2.7 0 4.96-.9 6.61-2.41l-3.23-2.5c-.9.6-2.04.96-3.38.96-2.6 0-4.8-1.76-5.59-4.12H3.08v2.58A9.99 9.99 0 0 0 12 22Zm-5.59-8.07A6 6 0 0 1 6.1 12c0-.67.11-1.32.31-1.93V7.49H3.08A9.99 9.99 0 0 0 2 12c0 1.61.39 3.14 1.08 4.51l3.33-2.58ZM12 5.95c1.47 0 2.79.5 3.83 1.5l2.87-2.87C16.96 2.96 14.7 2 12 2a9.99 9.99 0 0 0-8.92 5.49l3.33 2.58C7.2 7.71 9.4 5.95 12 5.95Z" />
      </svg>
    );
  }
  if (provider === "apple") {
    return (
      <svg {...common}>
        <path d="M16.37 12.6c-.02-2.2 1.8-3.26 1.88-3.31-1.03-1.5-2.62-1.7-3.18-1.73-1.35-.14-2.64.8-3.33.8-.69 0-1.74-.78-2.87-.76-1.47.02-2.83.86-3.59 2.18-1.53 2.66-.39 6.6 1.1 8.75.73 1.05 1.6 2.24 2.73 2.2 1.1-.05 1.51-.71 2.84-.71 1.32 0 1.7.71 2.86.69 1.18-.02 1.93-1.07 2.65-2.13.84-1.22 1.18-2.4 1.2-2.46-.03-.01-2.3-.88-2.3-3.52ZM14.2 6.13c.6-.73 1.01-1.75.9-2.76-.87.04-1.92.58-2.54 1.31-.56.64-1.05 1.67-.92 2.66.97.08 1.96-.49 2.56-1.21Z" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M3 3h8.5v8.5H3V3Zm9.5 0H21v8.5h-8.5V3ZM3 12.5h8.5V21H3v-8.5Zm9.5 0H21V21h-8.5v-8.5Z" />
    </svg>
  );
}
