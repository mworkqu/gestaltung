// Real Supabase wiring for handleClaimGuest (lib/auth/claim-guest.ts), shared
// by POST /api/auth/claim-guest (email sign-in) and /api/auth/callback
// (social sign-in). The token is never logged or stored.

import type { SupabaseClient } from "@supabase/supabase-js";

import { isMissingFunction, type ClaimDeps } from "@/lib/auth/claim-guest";

/**
 * `supabase` = the cookie-bound client of this request (the account now
 * signed in); `service` = the service-role client (verifies the guest token,
 * runs claim_guest_work).
 */
export function claimGuestDeps(supabase: Pick<SupabaseClient, "auth">, service: SupabaseClient): ClaimDeps {
  return {
    async sessionUser() {
      const { data, error } = await supabase.auth.getUser();
      return error || !data.user ? null : { id: data.user.id, is_anonymous: data.user.is_anonymous ?? false };
    },
    async userFromToken(token) {
      const { data, error } = await service.auth.getUser(token);
      return error || !data.user ? null : { id: data.user.id, is_anonymous: data.user.is_anonymous ?? false };
    },
    async claim(from, to) {
      const { data, error } = await service.rpc("claim_guest_work", { p_from: from, p_to: to });
      if (error) {
        if (isMissingFunction(error)) return { ok: false, missing: true };
        console.error("[claim-guest] claim_guest_work failed:", error.code ?? "", error.message);
        return { ok: false, message: error.message };
      }
      return { ok: true, data };
    },
  };
}
