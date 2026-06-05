import { createClient } from "@/lib/supabase/server";
import type { Profile, Tenant } from "@/lib/supabase/types";

export type SessionContext = {
  email: string;
  profile: Profile;
  tenant: Tenant | null;
};

// Resolves the current user together with their profile (role + tenant) and the
// tenant row itself. Returns null when there is no session OR no profile yet.
// All reads go through the request-scoped, RLS-enforced server client, so this
// also exercises the policies it depends on.
export async function getSessionContext(): Promise<SessionContext | null> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role, tenant_id, full_name, locale, created_at")
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
