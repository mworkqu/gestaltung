// Shared row/role types for the auth + multi-tenant layer (Stage 4).
// Kept hand-written for now; can be replaced by generated Supabase types later.

import type { PaymentMethod } from "@/lib/company";
import type { CadTier } from "@/lib/credits/classify";
import type { ProjectBom } from "@/lib/prototyping/bom-types";
import type { ProjectNetlist } from "@/lib/prototyping/netlist";
import type { Discipline } from "@/lib/prototyping/constants";
import type { PartSource } from "@/lib/prototyping/parts";
import type { Spec } from "@/lib/prototyping/spec";
import type { DisciplineState } from "@/lib/prototyping/tree";
import type { ShippingTier } from "@/lib/store/delivery";
import type { LeadTimeClass } from "@/lib/store/sourcing";

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
  // 0042 (copy of auth.users.email) and 0060 (price experiment cohort);
  // optional for pre-migration rows.
  email?: string | null;
  price_cohort?: string | null;
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
  // 0028. Derived sourcing; absent before that migration.
  pricing_mode?: "markup" | "mirror";
  income_pct?: number | null;
  below_floor?: boolean;
  lead_time_class?: LeadTimeClass | null;
  // 0030. Normalised name (trigger-maintained) and, on a merged duplicate, the
  // product it was merged into; absent before that migration.
  name_key?: string | null;
  merged_into?: string | null;
  // 0048. Storefront category (one of nine, lib/store/store-categories.ts);
  // `category` stays the supplier/source category. Absent before 0048.
  store_category?: string | null;
  store_category_review?: boolean;
  // 0069. True while we hold the product ourselves in Lusail (the count stays admin-only).
  in_own_stock?: boolean;
  // 0025. Free-form electronics attributes (jsonb, default {}) and pieces per
  // listing (integer >= 1, default 1); optional for pre-migration rows.
  attributes?: Record<string, unknown> | null;
  pack_size?: number;
  // 0028. Supplier-offer links and derived money, maintained by
  // refresh_part_sourcing(); the two *_qar columns are admin-only data.
  pinned_offer_id?: string | null;
  preferred_offer_id?: string | null;
  landed_cost_qar?: number | null;
  expected_income_qar?: number | null;
  // 0029. [{ web, thumb, path, drive_file_id }] (jsonb, default []); optional
  // for pre-migration rows.
  images?: { web: string; thumb: string; path: string | null; drive_file_id: string | null }[];
  // 0031. Rows created by the e2e / test accounts; optional for pre-migration rows.
  is_test?: boolean;
  // 0041. Supplier datasheet link, supplier parameter table (jsonb rows, see
  // lib/store/specs.ts) and the part this one is a backup for.
  datasheet_url?: string | null;
  specs?: unknown;
  backup_for?: string | null;
  // 0047. Arabic parameter table (jsonb) and when the Arabic details were written.
  specs_ar?: unknown;
  details_ar_at?: string | null;
  created_at: string;
  updated_at: string;
};

// 0053 set; rows read before 0053 runs may still say "pending"/"processing"
// (normaliseOrderStatus in lib/orders/status.ts maps them).
export type PartOrderStatus =
  | "confirmed"
  | "paid"
  | "sourcing"
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
  // Columns added after 0011; all optional for pre-migration rows.
  // 0025 / 0042: money taken off the order (numeric(10,2), default 0).
  discount_qar?: number;
  credit_discount_qar?: number;
  // 0029: delivery quote recorded by create_part_order.
  shipping_tier?: ShippingTier | null;
  split_shipments?: boolean;
  shipping_qar?: number;
  handling_fee_qar?: number;
  promised_date?: string | null;
  early_promised_date?: string | null;
  held_by?: string | null;
  confirmation_emailed_at?: string | null;
  delay_notified_at?: string | null;
  // 0031 test flag, 0032 "date to be confirmed" lines, 0039 payment method.
  is_test?: boolean;
  has_on_request?: boolean;
  payment_method?: PaymentMethod | null;
  // 0097: school class the order was placed for and its per-team split.
  class_id?: string | null;
  class_breakdown?: { team_id: string; team_name: string; project_id: string | null }[] | null;
};

// A single line in the localStorage cart. Carries the snapshot needed to render
// the cart without re-fetching, keyed by the part's (unique) SKU.
export type CartItem = {
  /** The cart_items row; absent for the legacy localStorage cart. */
  rowId?: string;
  // Null = bought straight from the store, not tied to any project.
  projectId?: string | null;
  projectName?: string | null;
  /** Lines bought together as a project kit share this (0025). */
  kitId?: string | null;
  /** The BOM lines this cart line fulfils (0025). */
  bomLines?: string[];
  partId: string;
  sku: string;
  name: string;
  nameAr: string | null;
  unitPrice: number;
  imageUrl: string | null;
  minOrderQty: number;
  /** 0028; null = available on request (orderable, date to be confirmed — 0032). */
  leadTimeClass?: LeadTimeClass | null;
  /** Pieces in one listing (lib/store/pack): "1 pack of 5". Absent on old snapshots = 1. */
  packSize?: number;
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
  is_test?: boolean | null;
  // W2b (0073): absent before the migration runs.
  project_id?: string | null;
  quote_calc?: unknown;
  final_quote_qar?: number | string | null;
  quote_note?: string | null;
  quoted_at?: string | null;
  quoted_by?: string | null;
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
  // 0025. How the electronics are built; null until the client chooses.
  build_route?: "prototype" | "custom_pcb" | null;
  // 0040. Generated starter firmware (lib/prototyping/firmware.ts Firmware).
  firmware?: unknown;
  // 0031 test flag; 0042 lifecycle + CAD credit state (status default 'active',
  // free_wiring_used default false, cad_regens_remaining default 0); optional
  // for pre-migration rows.
  is_test?: boolean;
  status?: "active" | "archived";
  free_wiring_used?: boolean;
  cad_tier?: CadTier | null;
  cad_regens_remaining?: number;
  // 0045. Guest recovery link: contact address, one-time token, when it was mailed.
  contact_email?: string | null;
  recovery_token?: string | null;
  recovery_emailed_at?: string | null;
  // 0068. The design-studio document (lib/studio/schema.ts StudioDoc, kept
  // opaque here) and its optimistic-lock version (default 0).
  studio?: unknown;
  studio_version?: number;
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

export type ClientInventoryItem = {
  id: string;
  user_id: string;
  product_id: string | null;
  custom_name: string | null;
  quantity: number;
  image_path: string | null;
  note: string | null;
  // 0025 (jsonb, default {}); optional for pre-migration rows.
  attributes?: Record<string, unknown>;
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
