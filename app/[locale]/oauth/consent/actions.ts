"use server";

import { redirect } from "next/navigation";

import { asLocale } from "@/lib/locale";
import { createClient } from "@/lib/supabase/server";

// The consent decision (Phase 4a). Supabase Auth is the authorization server:
// it mints the code and builds the redirect back to the chat, so all we do is
// pass the person's answer on and follow the URL it gives us.
//
// Both actions need the person's own session, which is why they run on the
// cookie-bound client. Nothing here is reachable without it.

const AUTH_ID = /^[A-Za-z0-9._~-]{8,200}$/;

async function decide(formData: FormData, approve: boolean): Promise<never> {
  const id = String(formData.get("authorization_id") ?? "");
  const locale = asLocale(formData.get("locale"));
  const back = `/${locale}/oauth/consent?authorization_id=${encodeURIComponent(id)}`;

  if (!AUTH_ID.test(id)) redirect(`${back}&error=bad_request`);

  const supabase = await createClient();
  const { data, error } = approve
    ? await supabase.auth.oauth.approveAuthorization(id, { skipBrowserRedirect: true })
    : await supabase.auth.oauth.denyAuthorization(id, { skipBrowserRedirect: true });

  if (error || !data?.redirect_url) {
    console.error("[oauth] consent decision failed:", error?.message ?? "no redirect_url");
    redirect(`${back}&error=failed`);
  }

  // Supabase built this URL from the client's own registered redirect_uri and
  // put the code (or the access_denied error) and the state on it.
  redirect(data.redirect_url);
}

export async function approveAction(formData: FormData): Promise<void> {
  await decide(formData, true);
}

export async function denyAction(formData: FormData): Promise<void> {
  await decide(formData, false);
}
