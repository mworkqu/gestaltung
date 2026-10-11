"use client";

// Browser side of "keep a guest's work across sign-in" (W1, 2026-10-11).
// Reusable by any in-flow sign-in (the sign-in page today, the "Get it made"
// pop-up later):
//
//   const token = await guestAccessToken(supabase);   // BEFORE signInWithPassword
//   …sign in…
//   if (token) await claimGuestWork(token);           // never throws
//
// A failed claim is kept for this tab (sessionStorage) and announced with a
// window event, so <GuestClaimNotice> (site layout) shows "Try again" on
// whatever page the visitor lands on. Nothing fails silently.

import type { SupabaseClient } from "@supabase/supabase-js";

export const CLAIM_PENDING_KEY = "g360:claim-guest";
export const CLAIM_EVENT = "g360:claim-guest";
const CLAIM_URL = "/api/auth/claim-guest";
const TIMEOUT_MS = 12_000;

export type ClaimState = "pending" | "done";

/** The current session's access token when it is a guest (anonymous) session, else null. Reads no network. */
export async function guestAccessToken(supabase: Pick<SupabaseClient, "auth">): Promise<string | null> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session?.user?.is_anonymous === true && session.access_token ? session.access_token : null;
  } catch {
    return null;
  }
}

function announce(state: ClaimState) {
  try {
    window.dispatchEvent(new CustomEvent(CLAIM_EVENT, { detail: state }));
  } catch {
    /* no window */
  }
}

function remember(token: string) {
  try {
    sessionStorage.setItem(CLAIM_PENDING_KEY, token);
  } catch {
    /* storage blocked: the notice still shows for this page via the event */
  }
}

function forget() {
  try {
    sessionStorage.removeItem(CLAIM_PENDING_KEY);
  } catch {
    /* storage blocked */
  }
}

/** A claim that failed earlier in this tab, if any. */
export function pendingClaimToken(): string | null {
  try {
    return sessionStorage.getItem(CLAIM_PENDING_KEY);
  } catch {
    return null;
  }
}

async function post(token: string): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(CLAIM_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
      credentials: "same-origin",
      signal: ctrl.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Moves the guest's projects, cart and the rest to the account now signed in.
 * true = done. false = kept as pending + the notice is told; never throws.
 */
export async function claimGuestWork(token: string): Promise<boolean> {
  const ok = await post(token);
  if (ok) {
    forget();
    announce("done");
  } else {
    remember(token);
    announce("pending");
  }
  return ok;
}

/** How long sign-in waits for the claim before it moves on (W8). The claim keeps running. */
export const CLAIM_WAIT_MS = 2_500;

/**
 * Same as claimGuestWork, but sign-in never waits longer than `ms`. When the claim is slow the
 * visitor is let through with the usual "Try again" notice showing (kept as pending); the
 * request itself carries on and clears the notice when it lands, calling `onLateDone` so the
 * page can show the account's data. true = done within the wait.
 */
export async function claimGuestWorkBounded(
  token: string,
  opts: { ms?: number; onLateDone?: () => void } = {},
): Promise<boolean> {
  let late = false;
  const work = claimGuestWork(token).then((ok) => {
    if (late && ok) opts.onLateDone?.();
    return ok;
  });
  const slow = new Promise<"slow">((resolve) => setTimeout(() => resolve("slow"), opts.ms ?? CLAIM_WAIT_MS));
  const first = await Promise.race([work, slow]);
  if (first !== "slow") return first;
  late = true;
  remember(token);
  announce("pending");
  return false;
}

/** "Try again" for a pending claim. true = done (or nothing was pending). */
export async function retryPendingClaim(): Promise<boolean> {
  const token = pendingClaimToken();
  if (!token) return true;
  return claimGuestWork(token);
}

/** "Dismiss": stop offering the retry in this tab. */
export function dismissPendingClaim() {
  forget();
  announce("done");
}
