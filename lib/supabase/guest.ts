"use client";

import type { User } from "@supabase/supabase-js";

import { shareInflight } from "@/lib/dedupe";
import { createClient } from "@/lib/supabase/client";
import { requestTurnstileToken } from "@/lib/turnstile-client";

// ── Guest sessions ──────────────────────────────────────────────────────────
//
// A visitor can start a project without an account. Rather than inventing a
// parallel "guest" concept, they get a real Supabase anonymous user, so they
// have a genuine auth.uid() and every RLS policy applies to them unchanged.
//
// MAU: every anonymous user counts toward the project's monthly active users,
// so a session is minted LAZILY — only when the visitor actually does something
// that needs to be saved (starts a project, adds to a cart). Merely reading a
// page never creates one. See FINDINGS.md for the cleanup rule that reaps
// anonymous users who never went on to own anything.

/**
 * Returns the current user, creating an anonymous one if there is no session.
 * Call this immediately before the first write of any guest-initiated action.
 *
 * CAPTCHA (P2-08, FINDINGS #8): once Supabase's Attack Protection → CAPTCHA is
 * on, signInAnonymously needs a Turnstile token. Callers with their own widget
 * pass it as `captchaToken`; otherwise the page's challenge dialog is asked
 * for one (requestTurnstileToken). With the store_settings switch off there is
 * no widget and no dialog, the token is null, and the call is exactly the old
 * signInAnonymously() with no options. A token is single-use: callers reset
 * their widget after this resolves or throws.
 */
export async function ensureSession(opts: { captchaToken?: string | null } = {}): Promise<User> {
  const supabase = createClient();

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (session?.user) return session.user;

  const captchaToken = opts.captchaToken || (await requestTurnstileToken());
  const { data, error } = captchaToken
    ? await supabase.auth.signInAnonymously({ options: { captchaToken } })
    : await supabase.auth.signInAnonymously();
  if (error) throw error;
  if (!data.user) throw new Error("Anonymous sign-in returned no user");

  return data.user;
}

/** True when this user has not yet attached an email — i.e. is still a guest. */
export function isGuest(user: User | null | undefined): boolean {
  return user?.is_anonymous === true;
}

/**
 * The current user without creating one. Null for a first-time visitor.
 *
 * Reads the session the browser already holds (cookie), so a visitor with no
 * session costs no request and a signed-in one costs none either (the access
 * token is only refreshed when it is about to expire). Concurrent callers share
 * one read. Row-level security checks the token on every query, so nothing here
 * grants access; it only tells the UI who is asking. Use auth.getUser() where a
 * server-verified identity matters (account upgrade, sign-up).
 */
export const getCurrentUser: () => Promise<User | null> = shareInflight(async () => {
  const {
    data: { session },
  } = await createClient().auth.getSession();
  return session?.user ?? null;
});
