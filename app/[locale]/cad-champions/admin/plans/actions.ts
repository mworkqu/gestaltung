"use server";

import { revalidatePath } from "next/cache";

import { saveCohort, saveCoupon, savePlan } from "@/lib/cad-champions/admin/plans-admin-server";
import { adminGuard } from "@/lib/cad-champions/admin/server";
import { CC_LOCALES } from "@/lib/cad-champions/db/types";
import { ccPath } from "@/lib/cad-champions/routes";

// Plans, coupons and cohorts actions. Admin only, checked on the server for
// every call. After a save the pricing / checkout pages are revalidated.

export type SaveResult = { ok: true; id: string } | { ok: false; error: "forbidden" | "unavailable" | "invalid" | "not_set_up" | "not_found" | "conflict" | "error"; fields?: Record<string, string> };

function refresh() {
  for (const l of CC_LOCALES) {
    revalidatePath(ccPath(l, "/admin/plans"));
    revalidatePath(ccPath(l, "/training/join"));
    revalidatePath(ccPath(l, "/training/join/checkout"));
  }
}

type Values = Record<string, unknown>;
const idOf = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

export async function savePlanAction(input: { id: string | null; values: Values }): Promise<SaveResult> {
  const g = await adminGuard("admin");
  if (!g.ok) return { ok: false, error: g.error };
  const r = await savePlan(g.db, g.cc.user.id, idOf(input?.id), input?.values ?? {});
  if (r.ok) refresh();
  return r;
}

export async function saveCouponAction(input: { id: string | null; values: Values }): Promise<SaveResult> {
  const g = await adminGuard("admin");
  if (!g.ok) return { ok: false, error: g.error };
  const r = await saveCoupon(g.db, g.cc.user.id, idOf(input?.id), input?.values ?? {});
  if (r.ok) refresh();
  return r;
}

export async function saveCohortAction(input: { id: string | null; values: Values }): Promise<SaveResult> {
  const g = await adminGuard("admin");
  if (!g.ok) return { ok: false, error: g.error };
  const r = await saveCohort(g.db, g.cc.user.id, idOf(input?.id), input?.values ?? {});
  if (r.ok) refresh();
  return r;
}
