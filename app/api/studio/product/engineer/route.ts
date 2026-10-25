import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { loadDocPrivate } from "@/lib/studio/server/doc";
import { isSuperAdmin, json, loadErrorStatus } from "@/lib/studio/server/product";

// GET /api/studio/product/engineer?projectId → super_admin only:
//   200 {product, productPrivate}  (every design's ProductModel JSON, source,
//   solver issues, vision score, loops, looksLike, missing) for the Engineer view.

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json({ error: "sign_in" }, 401);
  if (!(await isSuperAdmin(supabase, user.id))) return json({ error: "forbidden" }, 403);
  const projectId = z.string().uuid().safeParse(new URL(request.url).searchParams.get("projectId"));
  if (!projectId.success) return json({ error: "bad_request" }, 400);

  const cur = await loadDocPrivate(supabase, projectId.data);
  if (!cur.ok) return json({ error: cur.error }, loadErrorStatus(cur.error));
  return json({ product: cur.owned.product, productPrivate: cur.owned.productPrivate ?? { designs: [] } });
}
