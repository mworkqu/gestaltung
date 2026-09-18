"use client";

import type { User } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/client";

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
 */
export async function ensureSession(): Promise<User> {
  const supabase = createClient();

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (session?.user) return session.user;

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
  if (!data.user) throw new Error("Anonymous sign-in returned no user");

  return data.user;
}

/** True when this user has not yet attached an email — i.e. is still a guest. */
export function isGuest(user: User | null | undefined): boolean {
  return user?.is_anonymous === true;
}

/** The current user without creating one. Null for a first-time visitor. */
export async function getCurrentUser(): Promise<User | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ?? null;
}
