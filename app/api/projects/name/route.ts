import { logUsage, quota } from "@/lib/ai/usage";
import { DEFAULT_PROJECT_NAME } from "@/lib/projects/create-from-chat";
import { NAME_SCHEMA, generateProjectName } from "@/lib/projects/name-from-brief";
import { isUuid } from "@/lib/projects/recovery";
import { callGemini, geminiConfigured } from "@/lib/prototyping/providers/gemini-client";
import { ProviderError } from "@/lib/prototyping/providers/types";
import { createClient } from "@/lib/supabase/server";

// Names a project created from the chat (P1-11 / CC-1). The workspace calls
// this once when it opens with ?start=chat and the project is still called
// "New project". Same gate as /api/brief-chat: a session (guests count), the
// daily guard, metered as feature "analyse". Reads and writes through the
// caller's RLS client, so only the owner's own project can be named. Any
// failure answers { name: null } with 200 and the placeholder stays.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const none = () => Response.json({ name: null });

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response(null, { status: 401 });

  const body = (await request.json().catch(() => null)) as { projectId?: unknown; locale?: unknown } | null;
  const projectId = isUuid(body?.projectId) ? (body?.projectId as string) : null;
  const locale = body?.locale === "ar" ? "ar" : "en";
  if (!projectId) return none();

  const { data: project } = await supabase
    .from("projects")
    .select("id, name, brief")
    .eq("id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!project || project.name !== DEFAULT_PROJECT_NAME || !String(project.brief ?? "").trim()) return none();

  if (!geminiConfigured()) return none();
  if ((await quota(supabase, "gemini")).paused) return none();

  const name = await generateProjectName({
    brief: project.brief,
    locale,
    call: async ({ system, prompt }) => {
      try {
        const res = await callGemini({ system, prompt, schema: NAME_SCHEMA, temperature: 0.3, timeoutMs: 30_000 });
        await logUsage(supabase, {
          provider: "gemini",
          model: res.model,
          projectId,
          feature: "analyse",
          promptTokens: res.usage?.input,
          completionTokens: res.usage?.output,
          totalTokens: res.usage?.total,
          latencyMs: res.latencyMs,
          outcome: "ok",
        });
        return res.raw;
      } catch (e) {
        const reason = e instanceof ProviderError ? e.reason : "unavailable";
        await logUsage(supabase, { provider: "gemini", projectId, feature: "analyse", outcome: "error", errorCode: reason });
        throw e;
      }
    },
  });
  if (!name) return none();

  // Only while it is still the placeholder: a rename by the client wins.
  const { data: updated, error } = await supabase
    .from("projects")
    .update({ name })
    .eq("id", projectId)
    .eq("name", DEFAULT_PROJECT_NAME)
    .select("id");
  if (error || !updated?.length) return none();
  return Response.json({ name });
}
