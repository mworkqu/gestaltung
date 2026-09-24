import { createClient } from "@/lib/supabase/server";
import { escapeHtml, OWNER_EMAIL, sendEmail } from "@/lib/email";

// Demand signals (Task 18b): view, add_to_cart, request, zero_search.
// Written through public.record_demand() (SECURITY DEFINER; stamps the
// caller's user id when signed in). A "request this item" also emails the
// owner, since it's the strongest signal we get.

export const dynamic = "force-dynamic";

const KINDS = new Set(["view", "add_to_cart", "request", "zero_search"]);
const UUID = /^[0-9a-f-]{36}$/i;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const kind = typeof body?.kind === "string" ? body.kind : "";
  if (!KINDS.has(kind)) return new Response(null, { status: 400 });

  const str = (k: string, max: number) => (typeof body?.[k] === "string" ? (body[k] as string).slice(0, max) : null);
  const partId = str("partId", 36);
  if (partId && !UUID.test(partId)) return new Response(null, { status: 400 });
  const quantity = Number(body?.quantity);

  const supabase = await createClient();
  const { error } = await supabase.rpc("record_demand", {
    p_kind: kind,
    p_part_id: partId,
    p_source_page: str("sourcePage", 300),
    p_email: str("email", 200),
    p_quantity: Number.isFinite(quantity) && quantity >= 1 ? Math.trunc(quantity) : null,
    p_note: str("note", 1000),
    p_search_term: str("searchTerm", 200),
  });
  if (error) {
    const bad = error.message.includes("email required");
    return Response.json({ error: bad ? "email" : "failed" }, { status: bad ? 400 : 500 });
  }

  if (kind === "request" && partId) {
    const { data: part } = await supabase.from("parts").select("sku, name").eq("id", partId).maybeSingle();
    const e = (s: string | null) => escapeHtml(s ?? "");
    await sendEmail({
      to: [OWNER_EMAIL],
      replyTo: str("email", 200) ?? undefined,
      subject: `Item request: ${part?.name ?? partId}`,
      html: `<p><b>${e(part?.name ?? "")}</b> (${e(part?.sku ?? "")})</p>
<p>Email: ${e(str("email", 200))}<br/>Quantity: ${e(String(Number.isFinite(quantity) && quantity >= 1 ? Math.trunc(quantity) : 1))}<br/>Page: ${e(str("sourcePage", 300))}</p>
<p>${e(str("note", 1000))}</p>`,
    });
  }

  return Response.json({ ok: true });
}
