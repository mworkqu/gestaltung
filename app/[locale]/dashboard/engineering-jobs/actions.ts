"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getSessionContextCached } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { ENGINEER_SERVICES_KEY, EngineerServicesSchema } from "@/lib/services/quote";
import { asLocale } from "@/lib/locale";
import { UUID_RE } from "@/lib/uuid";

// Admin controls for engineering jobs. admin_engineering_job_set (0091)
// re-checks super_admin and the status transition; we only pass the intent.

const VIEWS = ["open", "ready", "all"];

function back(locale: string, view: string, err: string | null) {
  const params = new URLSearchParams({ view: VIEWS.includes(view) ? view : "open", ...(err ? { err } : { done: "1" }) });
  return `/${locale}/dashboard/engineering-jobs?${params.toString()}`;
}

async function guard() {
  const s = await getSessionContextCached();
  if (s?.profile.role !== "super_admin") throw new Error("forbidden");
}

/** "Start" (in_progress) and "Mark failed" (refunds the tokens). */
export async function setJobStatus(formData: FormData) {
  const locale = asLocale(formData.get("locale"));
  const view = String(formData.get("view") ?? "open");
  await guard();

  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  const note = String(formData.get("note") ?? "").trim().slice(0, 500);
  if (!UUID_RE.test(id) || !["in_progress", "failed"].includes(status)) redirect(back(locale, view, "failed"));

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_engineering_job_set", {
    p_job: id,
    p_status: status,
    p_result_path: null,
    p_result_name: null,
    p_note: note || null,
  });
  revalidatePath(`/${locale}/dashboard/engineering-jobs`);
  revalidatePath(`/${locale}/dashboard/ai-costs`);
  redirect(back(locale, view, error ? "failed" : null));
}

/** Called by the upload form after the file is in the bucket. Marks the job ready and emails the user. */
export async function markJobReady(input: {
  jobId: string;
  path: string;
  name: string;
  note: string;
  locale: string;
}): Promise<{ ok: boolean }> {
  await guard();
  const locale = asLocale(input.locale);
  if (!UUID_RE.test(input.jobId)) return { ok: false };
  if (!input.path.startsWith(`jobs/${input.jobId}/`) || input.path.includes("..")) return { ok: false };

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_engineering_job_set", {
    p_job: input.jobId,
    p_status: "ready",
    p_result_path: input.path,
    p_result_name: input.name.slice(0, 200),
    p_note: input.note.trim().slice(0, 500) || null,
  });
  revalidatePath(`/${locale}/dashboard/engineering-jobs`);
  return { ok: !error };
}

// ── 0092: engineer service prices (store_settings 'engineer_services') ──────
export async function saveServicePrices(formData: FormData) {
  const locale = asLocale(formData.get("locale"));
  await guard();
  const num = (k: string) => Number(String(formData.get(k) ?? "").trim());
  const value = {
    assembly: { base_qar: num("assembly.base_qar"), per_component_qar: num("assembly.per_component_qar"), per_connection_qar: num("assembly.per_connection_qar"), days: num("assembly.days") },
    cad_engineer: { base_qar: num("cad_engineer.base_qar"), hourly_qar: num("cad_engineer.hourly_qar"), base_hours: num("cad_engineer.base_hours"), days: num("cad_engineer.days") },
    pcb_gerber: { base_qar: num("pcb_gerber.base_qar"), per_component_qar: num("pcb_gerber.per_component_qar"), days: num("pcb_gerber.days") },
    round_to_qar: num("round_to_qar"),
  };
  const parsed = EngineerServicesSchema.safeParse(value);
  if (!parsed.success) redirect(back(locale, "open", "prices"));
  const supabase = await createClient();
  const { error } = await supabase
    .from("store_settings")
    .upsert({ key: ENGINEER_SERVICES_KEY, value: parsed.data, updated_at: new Date().toISOString() }, { onConflict: "key" });
  revalidatePath(`/${locale}/dashboard/engineering-jobs`);
  redirect(back(locale, "open", error ? "failed" : null));
}
