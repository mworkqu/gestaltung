import type { User } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import type { Profile, Tenant } from "@/lib/supabase/types";

export type SessionContext = {
  email: string;
  profile: Profile;
  tenant: Tenant | null;
};

/**
 * The current auth user (revalidated server-side), or null when signed out.
 * An anonymous guest session is a user too (`is_anonymous === true`).
 */
export async function getAuthUser(): Promise<User | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ?? null;
}

// Resolves the current user together with their profile (role + tenant) and the
// tenant row itself. Returns null when there is no session OR no profile yet.
// All reads go through the request-scoped, RLS-enforced server client, so this
// also exercises the policies it depends on.
//
// Pass `knownUser` (from getAuthUser) to skip the second auth round trip when
// the caller has already read the user.
export async function getSessionContext(
  knownUser?: Pick<User, "id" | "email"> | null
): Promise<SessionContext | null> {
  const supabase = await createClient();

  const user =
    knownUser !== undefined
      ? knownUser
      : (await supabase.auth.getUser()).data.user;

  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role, tenant_id, full_name, phone, locale, created_at")
    .eq("id", user.id)
    .single<Profile>();

  if (!profile) return null;

  let tenant: Tenant | null = null;
  if (profile.tenant_id) {
    const { data } = await supabase
      .from("tenants")
      .select("id, type, name, created_at")
      .eq("id", profile.tenant_id)
      .single<Tenant>();
    tenant = data ?? null;
  }

  return { email: user.email ?? "", profile, tenant };
}
