import { applyChoose, findDesign } from "@/lib/studio/product/store";
import { studioRequest } from "@/lib/studio/server/context";
import { updateProductDoc } from "@/lib/studio/server/doc";
import { DesignRefBody, json, saveErrorStatus } from "@/lib/studio/server/product";

// POST /api/studio/product/choose {projectId, designId} → 200 {chosenId}
// Free: marks the design the client tapped. Its picture is what My projects,
// the quote page (/projects/[id]/request) and the admin lead show.

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const ctx = await studioRequest(request, DesignRefBody, { consent: false, owner: true });
  if (ctx instanceof Response) return ctx;
  const { supabase, body, project } = ctx;

  let missing = false;
  const saved = await updateProductDoc(supabase, ctx.userId, project.id, (s) => {
    if (!findDesign({ product: s.product, priv: s.priv }, body.designId)) {
      missing = true;
      return null;
    }
    if (s.product.chosenId === body.designId) return null;
    return { doc: s.doc, ...applyChoose({ product: s.product, priv: s.priv }, body.designId) };
  });
  if (missing) return json({ error: "not_found" }, 404);
  if (!saved.saved && saved.error) return json({ error: saved.error }, saveErrorStatus(saved.error));
  return json({ chosenId: body.designId });
}
