"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth/get-session";
import {
  JOB_METHODS,
  FILE_EXTS,
  JOB_STATUSES,
  JOB_PATHS,
  SPEED_TIERS,
  PRODUCTION_QTY_RANGES,
  POST_PROCESSING_OPTIONS,
  canVaryJob,
} from "@/lib/jobs/constants";
import type { Job, JobPart, JobVariationChange } from "@/lib/supabase/types";

export type CreateJobInput = {
  locale: string;
  title: string;
  material: string;
  quantity: number;
  notes: string;
  method: string;
  job_path: string;
  production_qty_range: string | null;
  speed_tier: string;
  post_processing: string[];
  inspection_report: boolean;
  files: {
    storage_path: string;
    file_name: string;
    file_ext: string;
    size_bytes: number;
  }[];
};

export type CreateJobResult = { error?: string; jobId?: string };

// Records the job + its file metadata. Files themselves are uploaded directly to
// Supabase Storage from the browser (RLS-protected) BEFORE this runs — this keeps
// large CAD files off the Vercel server-action 4.5MB body limit; DB writes stay
// server-side and RLS-enforced. We never touch the service-role key.
export async function createJob(
  input: CreateJobInput
): Promise<CreateJobResult> {
  const [session, supabase] = await Promise.all([
    getSessionContext(),
    createClient(),
  ]);
  if (!session) return { error: "error_unknown" };

  // Stage 6a: only clients (with a tenant) create jobs.
  if (session.profile.role !== "client" || !session.profile.tenant_id) {
    return { error: "error_not_client" };
  }
  const tenantId = session.profile.tenant_id;
  const locale = input.locale === "ar" ? "ar" : "en";

  const title = input.title?.trim();
  const material = input.material?.trim() || null;
  const notes = input.notes?.trim() || null;
  const method = input.method;
  const quantity = Number(input.quantity);

  if (!title) return { error: "error_required" };
  if (!(JOB_METHODS as readonly string[]).includes(method)) {
    return { error: "error_method" };
  }
  if (!Number.isInteger(quantity) || quantity < 1) {
    return { error: "error_quantity" };
  }

  // Stage 8b upsells. Every enum-ish field is validated against the shared
  // constant lists (the DB CHECK constraints back these up).
  const job_path = input.job_path;
  if (!(JOB_PATHS as readonly string[]).includes(job_path)) {
    return { error: "error_unknown" };
  }
  let production_qty_range: string | null = null;
  if (job_path === "production") {
    production_qty_range = input.production_qty_range ?? null;
    if (
      !production_qty_range ||
      !(PRODUCTION_QTY_RANGES as readonly string[]).includes(production_qty_range)
    ) {
      return { error: "error_qty_range" };
    }
  }
  const speed_tier = input.speed_tier;
  if (!(SPEED_TIERS as readonly string[]).includes(speed_tier)) {
    return { error: "error_unknown" };
  }
  const post_processing = [...new Set(input.post_processing ?? [])];
  for (const p of post_processing) {
    if (!(POST_PROCESSING_OPTIONS as readonly string[]).includes(p)) {
      return { error: "error_unknown" };
    }
  }
  const inspection_report = input.inspection_report === true;

  if (!input.files?.length) return { error: "error_no_files" };
  for (const f of input.files) {
    if (!(FILE_EXTS as readonly string[]).includes(f.file_ext)) {
      return { error: "error_file_type" };
    }
    // Defense-in-depth: the path must live under the caller's own tenant folder.
    if (!f.storage_path.startsWith(`${tenantId}/`)) {
      return { error: "error_unknown" };
    }
  }

  const { data: job, error: jobErr } = await supabase
    .from("jobs")
    .insert({
      client_tenant_id: tenantId,
      title,
      material,
      notes,
      method,
      quantity,
      job_path,
      production_qty_range,
      speed_tier,
      post_processing,
      inspection_report,
    })
    .select("id")
    .single();

  if (jobErr || !job) return { error: "error_unknown" };

  const rows = input.files.map((f) => ({
    job_id: job.id,
    storage_path: f.storage_path,
    file_name: f.file_name,
    file_ext: f.file_ext,
    size_bytes: f.size_bytes,
  }));

  const { error: filesErr } = await supabase.from("job_files").insert(rows);
  if (filesErr) {
    // Best-effort cleanup so we don't leave a job with no files.
    await supabase.from("jobs").delete().eq("id", job.id);
    return { error: "error_unknown" };
  }

  revalidatePath(`/${locale}/design/jobs`);
  return { jobId: job.id };
}

export type ActionResult = { error?: string; ok?: boolean };

// super_admin assigns (or clears) the workshop for a job. RLS + the status
// trigger enforce that only an admin may change the assignment.
export async function assignWorkshop(input: {
  locale: string;
  jobId: string;
  workshopTenantId: string | null;
}): Promise<ActionResult> {
  const locale = input.locale === "ar" ? "ar" : "en";
  const [session, supabase] = await Promise.all([
    getSessionContext(),
    createClient(),
  ]);
  if (!session) return { error: "error_unknown" };
  if (session.profile.role !== "super_admin") return { error: "error_not_admin" };

  const { error } = await supabase
    .from("jobs")
    .update({ assigned_workshop_tenant_id: input.workshopTenantId || null })
    .eq("id", input.jobId);

  if (error) return { error: "error_assign" };

  revalidatePath(`/${locale}/design/jobs`);
  revalidatePath(`/${locale}/design/jobs/${input.jobId}`);
  return { ok: true };
}

// Status change. The DB trigger decides legality per role (workshop advances one
// step on its assigned job; client cancels an unassigned submitted job;
// super_admin overrides). Any rejection surfaces as a translated error.
export async function changeStatus(input: {
  locale: string;
  jobId: string;
  status: string;
}): Promise<ActionResult> {
  const locale = input.locale === "ar" ? "ar" : "en";
  const [session, supabase] = await Promise.all([
    getSessionContext(),
    createClient(),
  ]);
  if (!session) return { error: "error_unknown" };
  if (!(JOB_STATUSES as readonly string[]).includes(input.status)) {
    return { error: "error_transition" };
  }

  const { error } = await supabase
    .from("jobs")
    .update({ status: input.status })
    .eq("id", input.jobId);

  if (error) return { error: "error_transition" };

  revalidatePath(`/${locale}/design/jobs`);
  revalidatePath(`/${locale}/design/jobs/${input.jobId}`);
  return { ok: true };
}

// ---- Stage 7: internal jobs + BOM + Start Job ------------------------------

export async function createInternalJob(input: {
  locale: string;
  title: string;
  notes: string;
  method: string;
  parts: { name: string; quantity: number; unit: string }[];
}): Promise<{ error?: string; jobId?: string }> {
  const locale = input.locale === "ar" ? "ar" : "en";
  const [session, supabase] = await Promise.all([
    getSessionContext(),
    createClient(),
  ]);
  if (!session) return { error: "error_unknown" };
  if (session.profile.role !== "workshop" || !session.profile.tenant_id) {
    return { error: "error_not_workshop" };
  }
  const tenantId = session.profile.tenant_id;

  const title = input.title?.trim();
  if (!title) return { error: "error_required" };
  if (!(JOB_METHODS as readonly string[]).includes(input.method)) {
    return { error: "error_method" };
  }

  // Keep only well-formed part rows.
  const parts = (input.parts ?? [])
    .map((p) => ({
      name: String(p.name ?? "").trim(),
      quantity: Number(p.quantity),
      unit: String(p.unit ?? "").trim() || "pcs",
    }))
    .filter((p) => p.name && Number.isFinite(p.quantity) && p.quantity > 0);

  // Internal job: client + assigned workshop are both this tenant, so the
  // workshop can advance it via the status-transition trigger.
  const { data: job, error } = await supabase
    .from("jobs")
    .insert({
      client_tenant_id: tenantId,
      assigned_workshop_tenant_id: tenantId,
      job_source: "internal",
      title,
      notes: input.notes?.trim() || null,
      method: input.method,
      quantity: 1,
      parts: parts.length ? parts : null,
    })
    .select("id")
    .single();

  if (error || !job) return { error: "error_unknown" };

  revalidatePath(`/${locale}/design/jobs`);
  return { jobId: job.id };
}

export async function addBomRow(input: {
  locale: string;
  jobId: string;
  inventoryItemId: string;
  quantityNeeded: number;
}): Promise<ActionResult> {
  const [session, supabase] = await Promise.all([
    getSessionContext(),
    createClient(),
  ]);
  if (!session) return { error: "error_unknown" };

  const qty = Number(input.quantityNeeded);
  if (!input.inventoryItemId || !Number.isFinite(qty) || qty <= 0) {
    return { error: "error_bom_invalid" };
  }

  const { error } = await supabase.from("job_bom").insert({
    job_id: input.jobId,
    inventory_item_id: input.inventoryItemId,
    quantity_needed: qty,
  });
  if (error) return { error: "error_unknown" };

  revalidatePath(`/${input.locale}/design/jobs/${input.jobId}`);
  return { ok: true };
}

export async function deleteBomRow(input: {
  locale: string;
  jobId: string;
  bomId: string;
}): Promise<ActionResult> {
  const [session, supabase] = await Promise.all([
    getSessionContext(),
    createClient(),
  ]);
  if (!session) return { error: "unauthorized" };

  await supabase.from("job_bom").delete().eq("id", input.bomId);
  revalidatePath(`/${input.locale}/design/jobs/${input.jobId}`);
  return { ok: true };
}

// Advances the job from 'submitted' to the first workshop step ('quoted'),
// then deducts BOM quantities from inventory (floored at 0). All RLS-enforced.
export async function startJob(input: {
  locale: string;
  jobId: string;
}): Promise<ActionResult> {
  const [session, supabase] = await Promise.all([
    getSessionContext(),
    createClient(),
  ]);
  if (!session) return { error: "error_unknown" };
  // Only the assigned workshop starts a job (it deducts ITS OWN stock).
  if (session.profile.role !== "workshop" || !session.profile.tenant_id) {
    return { error: "error_not_workshop" };
  }

  // Advance submitted -> quoted FIRST, as a compare-and-set on the current
  // status (the transition trigger validates the role + assignment). Exactly
  // one call can win this update, so the deduction below can never run twice
  // for the same job — repeating it used to double-deduct stock.
  const { data: started, error } = await supabase
    .from("jobs")
    .update({ status: "quoted" })
    .eq("id", input.jobId)
    .eq("status", "submitted")
    .eq("assigned_workshop_tenant_id", session.profile.tenant_id)
    .select("id");
  if (error || !started?.length) return { error: "error_transition" };

  // Pull the BOM with each item's current stock (RLS scopes both).
  const { data: bom } = await supabase
    .from("job_bom")
    .select("quantity_needed, inventory_item_id, inventory_items(quantity)")
    .eq("job_id", input.jobId);

  for (const raw of (bom ?? []) as unknown[]) {
    const row = raw as {
      quantity_needed: number;
      inventory_item_id: string;
      inventory_items:
        | { quantity: number }
        | { quantity: number }[]
        | null;
    };
    const item = Array.isArray(row.inventory_items)
      ? row.inventory_items[0] ?? null
      : row.inventory_items;
    if (!item) continue;
    const current = Number(item.quantity) || 0;
    const needed = Number(row.quantity_needed);
    const next = Math.max(0, current - needed);
    await supabase
      .from("inventory_items")
      .update({ quantity: next })
      .eq("id", row.inventory_item_id);
  }

  revalidatePath(`/${input.locale}/design/jobs/${input.jobId}`);
  revalidatePath(`/${input.locale}/inventory`);
  return { ok: true };
}

// ---- Stage 7b: variations (editing a job after creation) -------------------

// Render a parts list as a short, stable string for the variation trail.
function partsToText(parts: JobPart[] | null | undefined): string {
  const list = (parts ?? []).filter((p) => p && p.name);
  if (!list.length) return "—";
  return list.map((p) => `${p.name} ×${p.quantity} ${p.unit}`).join(", ");
}

// Append a variation row for the given field changes (no-op when nothing changed).
async function logVariation(
  supabase: Awaited<ReturnType<typeof createClient>>,
  jobId: string,
  changedBy: string | null,
  changedByRole: string,
  changes: JobVariationChange[]
) {
  if (!changes.length) return;
  await supabase.from("job_variations").insert({
    job_id: jobId,
    changed_by: changedBy,
    changed_by_role: changedByRole,
    changes,
  });
}

// Edit ("vary") a client-style job's spec. Permission per canVaryJob:
// the owner client may edit only while 'submitted'; the assigned workshop or
// super_admin may edit any non-delivered/cancelled job. Records a field-level
// before->after trail.
export async function updateJob(input: {
  locale: string;
  jobId: string;
  title: string;
  material: string;
  quantity: number;
  notes: string;
  method: string;
}): Promise<ActionResult> {
  const locale = input.locale === "ar" ? "ar" : "en";
  const [session, supabase] = await Promise.all([
    getSessionContext(),
    createClient(),
  ]);
  if (!session) return { error: "error_unknown" };

  // Load current state (RLS scopes visibility) for the permission check + diff.
  const { data: job } = await supabase
    .from("jobs")
    .select("*")
    .eq("id", input.jobId)
    .single<Job>();
  if (!job) return { error: "error_unknown" };

  const role = session.profile.role;
  const tenantId = session.profile.tenant_id;
  if (!canVaryJob({ role, tenantId, job })) return { error: "error_locked" };

  const title = input.title?.trim();
  const material = input.material?.trim() || null;
  const notes = input.notes?.trim() || null;
  const quantity = Number(input.quantity);

  if (!title) return { error: "error_required" };
  if (!(JOB_METHODS as readonly string[]).includes(input.method)) return { error: "error_method" };
  if (!Number.isInteger(quantity) || quantity < 1) return { error: "error_quantity" };

  const changes: JobVariationChange[] = [];
  if (job.title !== title) changes.push({ field: "title", from: job.title, to: title });
  if (job.method !== input.method)
    changes.push({ field: "method", from: job.method, to: input.method });
  if ((job.material ?? "") !== (material ?? ""))
    changes.push({ field: "material", from: job.material ?? "", to: material ?? "" });
  if (Number(job.quantity) !== quantity)
    changes.push({ field: "quantity", from: String(job.quantity), to: String(quantity) });
  if ((job.notes ?? "") !== (notes ?? ""))
    changes.push({ field: "notes", from: job.notes ?? "", to: notes ?? "" });

  // RLS + the status trigger allow the edit; .eq("status", job.status) is an
  // optimistic guard so a concurrent status move quietly rejects a stale edit.
  const { error } = await supabase
    .from("jobs")
    .update({ title, material, notes, method: input.method, quantity })
    .eq("id", input.jobId)
    .eq("status", job.status);

  if (error) return { error: "error_unknown" };

  await logVariation(supabase, input.jobId, session.profile.id, role, changes);

  revalidatePath(`/${locale}/design/jobs`);
  revalidatePath(`/${locale}/design/jobs/${input.jobId}`);
  return { ok: true };
}

// Edit ("vary") an internal (workshop-owned) job: title, method, notes, parts.
export async function updateInternalJob(input: {
  locale: string;
  jobId: string;
  title: string;
  notes: string;
  method: string;
  parts: { name: string; quantity: number; unit: string }[];
}): Promise<ActionResult> {
  const locale = input.locale === "ar" ? "ar" : "en";
  const [session, supabase] = await Promise.all([
    getSessionContext(),
    createClient(),
  ]);
  if (!session) return { error: "error_unknown" };

  const { data: job } = await supabase
    .from("jobs")
    .select("*")
    .eq("id", input.jobId)
    .single<Job>();
  if (!job) return { error: "error_unknown" };
  if (job.job_source !== "internal") return { error: "error_unknown" };

  const role = session.profile.role;
  const tenantId = session.profile.tenant_id;
  if (!canVaryJob({ role, tenantId, job })) return { error: "error_locked" };

  const title = input.title?.trim();
  const notes = input.notes?.trim() || null;
  if (!title) return { error: "error_required" };
  if (!(JOB_METHODS as readonly string[]).includes(input.method)) return { error: "error_method" };

  const parts: JobPart[] = (input.parts ?? [])
    .map((p) => ({
      name: String(p.name ?? "").trim(),
      quantity: Number(p.quantity),
      unit: String(p.unit ?? "").trim() || "pcs",
    }))
    .filter((p) => p.name && Number.isFinite(p.quantity) && p.quantity > 0);

  const changes: JobVariationChange[] = [];
  if (job.title !== title) changes.push({ field: "title", from: job.title, to: title });
  if (job.method !== input.method)
    changes.push({ field: "method", from: job.method, to: input.method });
  if ((job.notes ?? "") !== (notes ?? ""))
    changes.push({ field: "notes", from: job.notes ?? "", to: notes ?? "" });
  const oldParts = partsToText(job.parts);
  const newParts = partsToText(parts);
  if (oldParts !== newParts)
    changes.push({ field: "parts", from: oldParts, to: newParts });

  const { error } = await supabase
    .from("jobs")
    .update({ title, notes, method: input.method, parts: parts.length ? parts : null })
    .eq("id", input.jobId)
    .eq("status", job.status);

  if (error) return { error: "error_unknown" };

  await logVariation(supabase, input.jobId, session.profile.id, role, changes);

  revalidatePath(`/${locale}/design/jobs`);
  revalidatePath(`/${locale}/design/jobs/${input.jobId}`);
  return { ok: true };
}
