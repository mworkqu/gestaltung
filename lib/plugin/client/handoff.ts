// Browser-side calls for the chat-plugin handoff link (migration 0112 RPCs).
// A narrow cast instead of the generated Database types, so this compiles
// before and after `npm run db:types` knows these functions. Results are
// parsed with zod; anything unexpected becomes a typed failure, never a throw.

import { z } from "zod";

import { isMissingFunction } from "@/lib/supabase/errors";

export const HANDOFF_TOKEN_RE = /^[A-Za-z0-9_-]{20,200}$/;

const claimSchema = z.union([
  z.object({ ok: z.literal(true), project_id: z.string().min(1), needs_phone: z.boolean(), already: z.boolean().optional() }),
  z.object({ ok: z.literal(false), reason: z.string() }),
]);

const phoneSchema = z.union([z.object({ ok: z.literal(true) }), z.object({ ok: z.literal(false), reason: z.string() })]);

export type ClaimResult =
  | { ok: true; projectId: string; needsPhone: boolean }
  | { ok: false; reason: "sign_in" | "bad_token" | "project_limit" | "not_ready" | "error" };

export type PhoneResult = { ok: true } | { ok: false; reason: "bad_token" | "bad_phone" | "not_ready" | "error" };

type RpcClient = {
  rpc: (fn: string, args: Record<string, string>) => PromiseLike<{ data: unknown; error: unknown }>;
};

export async function claimPluginHandoff(supabase: unknown, token: string): Promise<ClaimResult> {
  try {
    const { data, error } = await (supabase as RpcClient).rpc("claim_plugin_handoff", { p_token: token });
    if (error) return { ok: false, reason: isMissingFunction(error) ? "not_ready" : "error" };
    const parsed = claimSchema.safeParse(data);
    if (!parsed.success) return { ok: false, reason: "error" };
    if (parsed.data.ok) return { ok: true, projectId: parsed.data.project_id, needsPhone: parsed.data.needs_phone };
    const r = parsed.data.reason;
    return { ok: false, reason: r === "sign_in" || r === "bad_token" || r === "project_limit" ? r : "error" };
  } catch {
    return { ok: false, reason: "error" };
  }
}

export async function setHandoffPhone(supabase: unknown, token: string, phone: string): Promise<PhoneResult> {
  try {
    const { data, error } = await (supabase as RpcClient).rpc("plugin_handoff_set_phone", { p_token: token, p_phone: phone });
    if (error) return { ok: false, reason: isMissingFunction(error) ? "not_ready" : "error" };
    const parsed = phoneSchema.safeParse(data);
    if (!parsed.success) return { ok: false, reason: "error" };
    if (parsed.data.ok) return { ok: true };
    const r = parsed.data.reason;
    return { ok: false, reason: r === "bad_token" || r === "bad_phone" ? r : "error" };
  } catch {
    return { ok: false, reason: "error" };
  }
}
