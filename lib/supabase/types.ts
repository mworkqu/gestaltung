// Shared row/role types for the auth + multi-tenant layer (Stage 4).
// Kept hand-written for now; can be replaced by generated Supabase types later.

export type Role = "super_admin" | "workshop" | "client";
export type TenantType = "workshop" | "client";

export type Tenant = {
  id: string;
  type: TenantType;
  name: string;
  created_at: string;
};

export type Profile = {
  id: string;
  role: Role;
  tenant_id: string | null;
  full_name: string | null;
  locale: string;
  created_at: string;
};
