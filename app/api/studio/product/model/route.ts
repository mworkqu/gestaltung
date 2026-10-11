import { createClient } from "@/lib/supabase/server";
import { finalModel } from "@/lib/studio/product/private";
import { findDesign } from "@/lib/studio/product/store";
import { loadDocPrivate } from "@/lib/studio/server/doc";
import { DesignRefQuery, isSuperAdmin, json } from "@/lib/studio/server/product";

// GET /api/studio/product/model?projectId&designId → 200 {model}
// ONLY after "Create my CAD" (studio.product.unlockedId === designId — a field
// the page can't write, see lib/studio/server/doc.ts) or for a super_admin.
// The worker builds the interactive viewer + STLs from it. Else 403 locked.

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json({ error: "sign_in" }, 401);
  const url = new URL(request.url);
  const q = DesignRefQuery.safeParse({ projectId: url.searchParams.get("projectId"), designId: url.searchParams.get("designId") });
  if (!q.success) return json({ error: "bad_request" }, 400);

  const cur = await loadDocPrivate(supabase, q.data.projectId);
  if (!cur.ok) return json({ error: cur.error }, cur.error === "not_found" ? 404 : 500);
  if (!cur.owned.product || !cur.owned.productPrivate) return json({ error: "not_found" }, 404);
  const found = findDesign({ product: cur.owned.product, priv: cur.owned.productPrivate }, q.data.designId);
  if (!found) return json({ error: "not_found" }, 404);

  const unlocked = cur.owned.product.unlockedId === q.data.designId;
  if (!unlocked && !(await isSuperAdmin(supabase, user.id))) return json({ error: "locked" }, 403);
  return json({ model: finalModel(found.priv) });
}
