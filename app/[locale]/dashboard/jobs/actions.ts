"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";

import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth/get-session";
import { JOB_METHODS, FILE_EXTS } from "@/lib/jobs/constants";

export type CreateJobInput = {
  locale: string;
  title: string;
  material: string;
  quantity: number;
  notes: string;
  method: string;
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
// large CAD files off the server-action request body while DB writes stay
// server-side and RLS-enforced. We never touch the service-role key.
export async function createJob(
  input: CreateJobInput
): Promise<CreateJobResult> {
  const locale = input.locale === "ar" ? "ar" : "en";
  const t = await getTranslations({ locale, namespace: "Jobs" });

  const session = await getSessionContext();
  if (!session) return { error: t("error_unknown") };

  // Stage 6a: only clients (with a tenant) create jobs.
  if (session.profile.role !== "client" || !session.profile.tenant_id) {
    return { error: t("error_not_client") };
  }
  const tenantId = session.profile.tenant_id;

  const title = input.title?.trim();
  const material = input.material?.trim() || null;
  const notes = input.notes?.trim() || null;
  const method = input.method;
  const quantity = Number(input.quantity);

  if (!title) return { error: t("error_required") };
  if (!(JOB_METHODS as readonly string[]).includes(method)) {
    return { error: t("error_method") };
  }
  if (!Number.isInteger(quantity) || quantity < 1) {
    return { error: t("error_quantity") };
  }
  if (!input.files?.length) return { error: t("error_no_files") };
  for (const f of input.files) {
    if (!(FILE_EXTS as readonly string[]).includes(f.file_ext)) {
      return { error: t("error_file_type") };
    }
    // Defense-in-depth: the path must live under the caller's own tenant folder.
    if (!f.storage_path.startsWith(`${tenantId}/`)) {
      return { error: t("error_unknown") };
    }
  }

  const supabase = await createClient();

  const { data: job, error: jobErr } = await supabase
    .from("jobs")
    .insert({ client_tenant_id: tenantId, title, material, notes, method, quantity })
    .select("id")
    .single();

  if (jobErr || !job) return { error: t("error_unknown") };

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
    return { error: t("error_unknown") };
  }

  revalidatePath(`/${locale}/dashboard/jobs`);
  return { jobId: job.id };
}
