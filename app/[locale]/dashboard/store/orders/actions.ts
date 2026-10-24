"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { after } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSuperAdmin } from "@/lib/auth/guards";
import { drainOutbox } from "@/lib/notifications/drain";
import { siteUrlFor } from "@/lib/projects/recovery";
import { canTransition, isOrderStatus, normaliseOrderStatus, toPre0053Status, type OrderStatus } from "@/lib/orders/status";
import { canMarkTest, nextStepFor } from "@/lib/orders/admin-rules";
import { setWhatsappSent } from "@/lib/orders/whatsapp";
import { asLocale } from "@/lib/locale";
import { isMissingFunction } from "@/lib/supabase/errors";

export type OrderStatusError =
  | "bad_status"
  | "bad_transition"
  | "same_status"
  | "not_found"
  | "needs_0053"
  | "failed";

export type OrderStatusState = { ok: true; status: OrderStatus } | { ok: false; error: OrderStatusError } | null;

/**
 * One status change: set_order_status (0053: validates the transition, writes
 * the history row with the note, fires the status email + the 0042 credit
 * grant on delivered). Before 0053 runs the RPC is missing: the same rule is
 * checked here and the status is written in the old vocabulary (sourcing →
 * processing); "paid" and the note need 0053.
 */
async function applyOrderStatus(id: string, status: OrderStatus, note: string): Promise<OrderStatusState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_order_status", { p_order: id, p_status: status, p_note: note || null });
  if (!error) return { ok: true, status };

  if (!isMissingFunction(error)) {
    const msg = error.message ?? "";
    for (const code of ["bad_transition", "same_status", "not_found", "bad_status"] as const) {
      if (msg.includes(code)) return { ok: false, error: code };
    }
    console.error(`[orders] set_order_status ${id} → ${status}: ${msg}`);
    return { ok: false, error: "failed" };
  }

  // Pre-0053 fallback.
  const { data: row } = await supabase.from("part_orders").select("status").eq("id", id).maybeSingle();
  if (!row) return { ok: false, error: "not_found" };
  if (!canTransition(row.status, status)) return { ok: false, error: row.status === status ? "same_status" : "bad_transition" };
  const legacy = toPre0053Status(status);
  if (!legacy) return { ok: false, error: "needs_0053" };
  const { error: upError } = await supabase.from("part_orders").update({ status: legacy }).eq("id", id);
  if (upError) {
    console.error(`[orders] legacy status update ${id} → ${legacy}: ${upError.message}`);
    return { ok: false, error: "failed" };
  }
  return { ok: true, status };
}

/** Send the queued status email now instead of at the next daily cron run. Best effort. */
async function drainSoon() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const siteUrl = siteUrlFor(`${proto}://${host}`);
  after(async () => {
    const db = createServiceClient();
    if (!db) return;
    try {
      const res = await drainOutbox(db, siteUrl, 20);
      if (!res.ok) console.warn(`[orders] drain after status change: ${res.error}`);
    } catch (e) {
      console.warn(`[orders] drain after status change failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  });
}

function revalidateOrder(locale: string, id: string) {
  revalidatePath(`/${locale}/dashboard/store/orders`);
  revalidatePath(`/${locale}/dashboard/store/orders/${id}`);
  revalidatePath(`/${locale}/orders`);
  revalidatePath(`/${locale}/orders/${id}`);
}

/** Admin order page: status + note form (useActionState). */
export async function setOrderStatus(_prev: OrderStatusState, formData: FormData): Promise<OrderStatusState> {
  const locale = asLocale(formData.get("locale"));
  await requireSuperAdmin(locale);

  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  const note = String(formData.get("note") ?? "").trim().slice(0, 1000);
  if (!id || !isOrderStatus(status)) return { ok: false, error: "bad_status" };

  const res = await applyOrderStatus(id, status, note);
  if (res?.ok) {
    revalidateOrder(locale, id);
    await drainSoon();
  }
  return res;
}

/** Orders list: inline select, no note. */
export async function updateOrderStatus(formData: FormData): Promise<void> {
  const locale = asLocale(formData.get("locale"));
  await requireSuperAdmin(locale);

  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id || !isOrderStatus(status)) return;

  const res = await applyOrderStatus(id, status, "");
  if (res?.ok) await drainSoon();
  revalidateOrder(locale, id);
}

export async function toggleWhatsappSent(formData: FormData): Promise<void> {
  const locale = asLocale(formData.get("locale"));
  await requireSuperAdmin(locale);

  const id = String(formData.get("id") ?? "");
  const next = formData.get("whatsapp_sent") === "true";
  if (!id) return;

  const supabase = await createClient();
  await setWhatsappSent(supabase, id, next);

  revalidatePath(`/${locale}/dashboard/store/orders`);
  revalidatePath(`/${locale}/dashboard/store/orders/${id}`);
}

export type OrderActionError = OrderStatusError | "paid_order" | "no_next_step";
export type OrderActionState = { ok: true } | { ok: false; error: OrderActionError };

/**
 * The next-step button (D3): moves the order to the ONE obvious next status.
 * The server decides the target from the order's current status and payment
 * method (nextStepFor), never from the browser, then uses the normal status
 * path (set_order_status: validates, writes order_status_history, queues the
 * status email).
 */
export async function advanceOrder(formData: FormData): Promise<OrderActionState> {
  const locale = asLocale(formData.get("locale"));
  await requireSuperAdmin(locale);

  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "not_found" };

  const supabase = await createClient();
  const { data: row } = await supabase.from("part_orders").select("status, payment_method").eq("id", id).maybeSingle();
  if (!row) return { ok: false, error: "not_found" };
  const step = nextStepFor(row.status, (row as { payment_method?: string | null }).payment_method);
  if (!step) return { ok: false, error: "no_next_step" };

  const res = await applyOrderStatus(id, step.to, "");
  if (!res?.ok) return { ok: false, error: res?.error ?? "failed" };
  revalidateOrder(locale, id);
  await drainSoon();
  return { ok: true };
}

/** Cancel an order (never deleted): the normal status change to "cancelled", logged in the history. */
export async function cancelOrder(formData: FormData): Promise<OrderActionState> {
  const locale = asLocale(formData.get("locale"));
  await requireSuperAdmin(locale);

  const id = String(formData.get("id") ?? "");
  const note = String(formData.get("note") ?? "").trim().slice(0, 1000);
  if (!id) return { ok: false, error: "not_found" };

  const res = await applyOrderStatus(id, "cancelled", note);
  if (!res?.ok) return { ok: false, error: res?.error ?? "failed" };
  revalidateOrder(locale, id);
  await drainSoon();
  return { ok: true };
}

/**
 * Mark an order as a test (part_orders.is_test, migration 0031) or undo it.
 * Refused on the server for paid orders and later (canMarkTest): money may have
 * been received. Un-marking is always allowed. Nothing is deleted.
 */
export async function setOrderTest(formData: FormData): Promise<OrderActionState> {
  const locale = asLocale(formData.get("locale"));
  await requireSuperAdmin(locale);

  const id = String(formData.get("id") ?? "");
  const value = formData.get("is_test") === "true";
  if (!id) return { ok: false, error: "not_found" };

  const supabase = await createClient();
  const { data: row } = await supabase.from("part_orders").select("status").eq("id", id).maybeSingle();
  if (!row) return { ok: false, error: "not_found" };
  if (value && !canMarkTest(normaliseOrderStatus(row.status) ?? row.status)) return { ok: false, error: "paid_order" };

  const { error } = await supabase.from("part_orders").update({ is_test: value }).eq("id", id);
  if (error) {
    console.error(`[orders] is_test ${id} -> ${value}: ${error.message}`);
    return { ok: false, error: "failed" };
  }
  revalidateOrder(locale, id);
  revalidatePath(`/${locale}/dashboard`);
  return { ok: true };
}
