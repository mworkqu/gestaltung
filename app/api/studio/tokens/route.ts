import { ideaStatus, tokenInfo } from "@/lib/studio/server/tokens";
import { ProductSpecSchema } from "@/lib/studio/schema";
import { requireUser } from "@/lib/auth/guards";
import { jsonOk } from "@/lib/http";

// GET /api/studio/tokens?projectId=… — the ideation token line beside the
// Studio chat: balance, tier of the saved card, turns until the next edit
// token. First sight grants the 5 welcome tokens (migration 0088).
// {tokens: null} before 0088 runs (the chat is free until then).

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;

  const raw = new URL(request.url).searchParams.get("projectId") ?? "";
  const projectId = /^[0-9a-f-]{36}$/i.test(raw) ? raw : null;
  const status = await ideaStatus(supabase, projectId);
  if (!status) return jsonOk({ tokens: null });

  let spec = null;
  if (projectId) {
    const { data } = await supabase.from("projects").select("studio").eq("id", projectId).maybeSingle();
    const parsed = ProductSpecSchema.safeParse((data?.studio as { spec?: unknown } | null)?.spec);
    spec = parsed.success ? parsed.data : null;
  }
  return jsonOk({ tokens: tokenInfo({ status, spec }) });
}
