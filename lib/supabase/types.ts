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
  phone: string | null;
  locale: string;
  created_at: string;
};

export type JobMethod =
  | "3d_printing"
  | "cnc_machining"
  | "laser_cutting"
  | "edm";

export type JobStatus =
  | "submitted"
  | "quoted"
  | "in_production"
  | "ready"
  | "delivered"
  | "cancelled";

export type FileExt = "stl" | "step" | "dxf" | "iges";

export type Job = {
  id: string;
  client_tenant_id: string;
  assigned_workshop_tenant_id: string | null;
  title: string;
  notes: string | null;
  material: string | null;
  quantity: number;
  method: JobMethod;
  status: JobStatus;
  created_at: string;
  updated_at: string;
};

export type JobFile = {
  id: string;
  job_id: string;
  storage_path: string;
  file_name: string;
  file_ext: FileExt;
  size_bytes: number | null;
  uploaded_at: string;
};

export type JobEvent = {
  id: string;
  job_id: string;
  from_status: JobStatus | null;
  to_status: JobStatus;
  note: string | null;
  actor: string | null;
  created_at: string;
};

export type InventoryItem = {
  id: string;
  tenant_id: string;
  sku: string;
  name: string;
  description: string | null;
  category: string | null;
  quantity: number;
  unit: string;
  unit_price: number | null;
  low_stock_threshold: number | null;
  created_at: string;
  updated_at: string;
};
