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

export type JobSource = "client" | "internal";

export type JobPart = { name: string; quantity: number; unit: string };

export type JobPath = "prototype" | "production";
export type SpeedTier = "standard" | "express";
export type ProductionQtyRange = "10-50" | "50-250" | "250-1000" | "1000+";
export type PostProcessing = "bead_blast" | "anodize";

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
  job_source: JobSource;
  parts: JobPart[] | null;
  job_path: JobPath;
  production_qty_range: ProductionQtyRange | null;
  speed_tier: SpeedTier;
  post_processing: PostProcessing[];
  inspection_report: boolean;
  created_at: string;
  updated_at: string;
};

export type JobBomRow = {
  id: string;
  job_id: string;
  inventory_item_id: string;
  quantity_needed: number;
  created_at: string;
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

// One changed field in a variation. `field` is a job column key
// (title | method | material | quantity | notes | parts); `from`/`to` are the
// display strings before and after the change.
export type JobVariationChange = { field: string; from: string; to: string };

export type JobVariation = {
  id: string;
  job_id: string;
  changed_by: string | null;
  changed_by_role: string | null;
  changes: JobVariationChange[];
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

// ─── Parts Store (e-commerce module) ─────────────────────────────────────────

export type StockStatus = "in_stock" | "low_stock" | "out_of_stock";

export type Part = {
  id: string;
  sku: string;
  name: string;
  name_ar: string | null;
  description: string | null;
  description_ar: string | null;
  category: string;
  material: string | null;
  standard: string | null;
  unit_price: number;
  min_order_qty: number;
  stock_status: StockStatus;
  image_url: string | null;
  is_published: boolean;
  created_at: string;
  updated_at: string;
};

export type PartOrderStatus =
  | "pending"
  | "confirmed"
  | "processing"
  | "shipped"
  | "delivered"
  | "cancelled";

export type PartOrder = {
  id: string;
  profile_id: string | null;
  customer_name: string;
  customer_phone: string;
  customer_email: string | null;
  delivery_area: string;
  delivery_notes: string | null;
  status: PartOrderStatus;
  total_qar: number;
  whatsapp_sent: boolean;
  created_at: string;
  updated_at: string;
};

export type PartOrderItem = {
  id: string;
  order_id: string;
  part_id: string;
  part_sku: string;
  part_name: string;
  quantity: number;
  unit_price_qar: number;
  line_total_qar: number;
};

// A single line in the localStorage cart. Carries the snapshot needed to render
// the cart without re-fetching, keyed by the part's (unique) SKU.
export type CartItem = {
  partId: string;
  sku: string;
  name: string;
  nameAr: string | null;
  unitPrice: number;
  imageUrl: string | null;
  minOrderQty: number;
  stockStatus: StockStatus;
  quantity: number;
};
