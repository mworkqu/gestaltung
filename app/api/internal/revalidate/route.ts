import { z } from "zod";

import { isAuthorizedCron } from "@/lib/auth/cron";
import { revalidateTags } from "@/lib/cache/storefront";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/http";
import { checkRevalidateTags } from "@/lib/worker/revalidate-tags";

// POST /api/internal/revalidate — the Mac Mini worker's way to purge the
// storefront cache after a job that changed it (it cannot call Next's
// revalidateTag itself). Body {tags: string[]}; only the storefront tag shapes
// (lib/worker/revalidate-tags.ts: parts, parts-listing, store-settings,
// contact-phone, part-<sku>), at most the per-SKU cap. Auth: Authorization:
// Bearer $WORKER_SECRET, constant-time; an unset secret refuses everything.
// Answers {purged: [...]} (the tags, de-duplicated).

export const dynamic = "force-dynamic";
export const maxDuration = 10;

const Body = z.object({ tags: z.array(z.unknown()) });

export async function POST(request: Request) {
  if (!isAuthorizedCron(request.headers.get("authorization"), process.env.WORKER_SECRET)) {
    return jsonError("unauthorized", 401);
  }
  const parsed = await parseJsonBody(request, Body, { maxBytes: 16_384 });
  if (!parsed.ok) return parsed.response;
  const check = checkRevalidateTags(parsed.data.tags);
  if (!check.ok) return jsonError(check.error, 400);
  return jsonOk({ purged: revalidateTags(check.tags) });
}
