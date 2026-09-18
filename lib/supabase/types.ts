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

// A lead captured by /api/store-lead or /api/design-quote. The public forms may
// insert; only super_admin can read or manage (RLS, migration 0002).
export type InquiryStatus = "new" | "contacted" | "closed";

export type Inquiry = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  message: string;
  locale: string;
  status: InquiryStatus;
  created_at: string;
};

// ── Projects ────────────────────────────────────────────────────────────────
// The client workspace. See supabase/migrations/0015_projects.sql.

export type Project = {
  id: string;
  user_id: string;
  tenant_id: string | null;
  name: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type ProjectBlockType = "text" | "image";

export type ProjectBlock = {
  id: string;
  project_id: string;
  type: ProjectBlockType;
  content: string | null;
  storage_path: string | null;
  position: number;
  created_at: string;
};

export type ProjectMaterial = {
  id: string;
  project_id: string;
  material: string;
  created_at: string;
};

export type ProjectItem = {
  id: string;
  project_id: string;
  product_id: string;
  quantity: number;
  note: string | null;
  created_at: string;
};

export type CartRow = {
  id: string;
  user_id: string;
  product_id: string;
  project_id: string | null;
  quantity: number;
  created_at: string;
  updated_at: string;
};

export type ClientInventoryItem = {
  id: string;
  user_id: string;
  product_id: string | null;
  custom_name: string | null;
  quantity: number;
  image_path: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
};
