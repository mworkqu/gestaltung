// Shared row/role types for the auth + multi-tenant layer (Stage 4).
// Kept hand-written for now; can be replaced by generated Supabase types later.

import type { ProjectBom } from "@/lib/prototyping/bom";
import type { ProjectNetlist } from "@/lib/prototyping/netlist";
import type { Discipline } from "@/lib/prototyping/constants";
import type { PartSource } from "@/lib/prototyping/parts";
import type { Spec } from "@/lib/prototyping/spec";
import type { DisciplineState } from "@/lib/prototyping/tree";

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
  // 0023. Free keywords for the BOM matcher; absent before that migration.
  tags?: string[] | null;
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
  // Null = bought straight from the store, not tied to any project.
  projectId?: string | null;
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
  // Prototyping (0020). `brief` is the prototyping input, kept separate from
  // `notes` so saving a note never re-triggers an analysis.
  brief: string | null;
  stage: string;
  stages: Record<string, string>;
  // 0021. Absent until that migration runs, so always optional here.
  disciplines?: DisciplineState | null;
  // 0022. The spec sheet ("What we understood"); null until first analysed.
  spec?: Spec | null;
  // 0023. Bill of materials (functions to buy) and the electronics netlist.
  bom?: ProjectBom | null;
  netlist?: ProjectNetlist | null;
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
  // How many of these units came off the client's own shelf rather than the
  // cart. The remainder is bought at checkout.
  qty_from_inventory: number;
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

// ── Prototyping ─────────────────────────────────────────────────────────────
// See supabase/migrations/0020_prototyping.sql and 0022. The brief's reading
// lives in projects.spec; project_claims is retired and no longer typed.

export type PartStatus = "suggested" | "confirmed" | "edited" | "added";

export type ProjectPart = {
  id: string;
  project_id: string;
  code: string;
  name: string;
  description: string | null;
  quantity: number;
  material: string | null;
  process: string | null;
  status: PartStatus;
  confidence: number;
  ai_material: string | null;
  ai_process: string | null;
  // 0022. Absent on databases that have not run it; treated as to_design.
  source?: PartSource;
  kind?: Discipline | null;
  catalog_part_id?: string | null;
  inventory_item_id?: string | null;
  sku?: string | null;
  unit_price?: number | null;
  stock_status?: string | null;
  stock_qty?: number | null;
  // 0023. Shape + millimetre dimensions for the dimension drawing.
  shape?: string | null;
  length_mm?: number | null;
  width_mm?: number | null;
  height_mm?: number | null;
  diameter_mm?: number | null;
  thickness_mm?: number | null;
  position: number;
  created_at: string;
  updated_at: string;
};

export type ProjectSchematic = {
  id: string;
  project_id: string;
  part_id: string | null;
  code: string;
  title: string;
  kind: string;
  created_at: string;
};

export type RevisionStatus = "generating" | "ready" | "failed" | "superseded";

export type ProjectSchematicRevision = {
  id: string;
  schematic_id: string;
  rev: number;
  status: RevisionStatus;
  prompt: string | null;
  note: string | null;
  svg: string | null;
  error: string | null;
  confidence: number | null;
  created_at: string;
};
