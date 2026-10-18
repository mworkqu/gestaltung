import { createClient } from "@/lib/supabase/server";
import { ideaStatus, tokenInfo } from "@/lib/studio/server/tokens";
import { ProductSpecSchema } from "@/lib/studio/schema";

// GET /api/studio/tokens?projectId=… — the ideation token line beside the
// Studio chat: balance, tier of the saved card, turns until the next edit
// token. First sight grants the 5 welcome tokens (migration 0088).
// {tokens: null} before 0088 runs (the chat is free until then).

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "sign_in" }, { status: 401 });

  const raw = new URL(request.url).searchParams.get("projectId") ?? "";
  const projectId = /^[0-9a-f-]{36}$/i.test(raw) ? raw : null;
  const status = await ideaStatus(supabase, projectId);
  if (!status) return Response.json({ tokens: null });

  let spec = null;
  if (projectId) {
    const { data } = await supabase.from("projects").select("studio").eq("id", projectId).maybeSingle();
    const parsed = ProductSpecSchema.safeParse((data?.studio as { spec?: unknown } | null)?.spec);
    spec = parsed.success ? parsed.data : null;
  }
  return Response.json({ tokens: tokenInfo({ status, spec }) });
}
