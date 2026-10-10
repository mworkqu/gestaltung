import { createClient } from "@/lib/supabase/server";
import { OWNER_EMAIL, sendEmail } from "@/lib/email";
import { leadsDashboardUrl, renderOwnerEmail } from "@/lib/email/lead-email";

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
  const qty = Number.isFinite(quantity) && quantity >= 1 ? Math.trunc(quantity) : 1;

  const supabase = await createClient();

  // "Request this item" for something we don't sell (a store search with no
  // results): no product id, the item is the typed text. record_demand() only
  // stores requests for existing products, so the term is kept as a
  // zero_search signal (restock dashboard) and the request itself is emailed.
  if (kind === "request" && !partId) {
    const item = str("searchTerm", 200)?.trim() ?? "";
    const email = str("email", 200)?.trim() ?? "";
    if (!item || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return Response.json({ error: "email" }, { status: 400 });
    const { error: recErr } = await supabase.rpc("record_demand", {
      p_kind: "zero_search",
      p_source_page: str("sourcePage", 300),
      p_search_term: item,
    });
    const mail = renderOwnerEmail({
      title: "Item request: not in the store",
      facts: [
        { label: "Item", value: item },
        { label: "Email", value: email, href: `mailto:${email}`, ltr: true },
        { label: "Quantity", value: String(qty) },
        ...(str("sourcePage", 300) ? [{ label: "Page", value: str("sourcePage", 300) ?? "", ltr: true }] : []),
      ],
      quote: str("note", 1000) ? { label: "Note", text: str("note", 1000) ?? "" } : undefined,
      buttons: [{ label: "Open in dashboard", url: leadsDashboardUrl() }],
    });
    const emailed = await sendEmail({
      to: [OWNER_EMAIL],
      replyTo: email,
      subject: `Item request (not in the store): ${item}`,
      html: mail.html,
      text: mail.text,
    });
    if (!emailed && recErr) return Response.json({ error: "failed" }, { status: 500 });
    return Response.json({ ok: true, emailed });
  }
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
    const reqEmail = str("email", 200);
    const mail = renderOwnerEmail({
      title: "Item request",
      facts: [
        { label: "Item", value: [part?.name, part?.sku && `(${part.sku})`].filter(Boolean).join(" ") },
        ...(reqEmail ? [{ label: "Email", value: reqEmail, href: `mailto:${reqEmail}`, ltr: true }] : []),
        { label: "Quantity", value: String(qty) },
        ...(str("sourcePage", 300) ? [{ label: "Page", value: str("sourcePage", 300) ?? "", ltr: true }] : []),
      ],
      quote: str("note", 1000) ? { label: "Note", text: str("note", 1000) ?? "" } : undefined,
      buttons: [{ label: "Open in dashboard", url: leadsDashboardUrl() }],
    });
    await sendEmail({
      to: [OWNER_EMAIL],
      replyTo: reqEmail ?? undefined,
      subject: `Item request: ${part?.name ?? partId}`,
      html: mail.html,
      text: mail.text,
    });
  }

  return Response.json({ ok: true });
}
