"use server";

import { adminGuard, type ActionResult } from "@/lib/cad-champions/admin/server";
import { findEmailTemplate, type RenderedEmail } from "@/lib/cad-champions/admin/email-templates";
import { sendEmailResult } from "@/lib/email";
import { createRateLimiter } from "@/lib/rate-limit";

// Email template actions. Admin only, checked on the server for every call.
// Sample data only; a test goes ONLY to the admin's own address.

const limiter = createRateLimiter({ limit: 6, windowMs: 60_000 });

const loc = (l: unknown): "en" | "ar" => (l === "ar" ? "ar" : "en");

export async function renderTemplateAction(input: { id: string; locale: string }): Promise<ActionResult<RenderedEmail>> {
  const g = await adminGuard("admin");
  if (!g.ok) return { ok: false, error: g.error };
  const def = findEmailTemplate(String(input?.id ?? ""));
  if (!def) return { ok: false, error: "not_found" };
  try {
    return { ok: true, data: def.render(loc(input.locale)) };
  } catch (e) {
    console.error("[cc-admin] email render failed:", def.id, e instanceof Error ? e.message : "unknown");
    return { ok: false, error: "error" };
  }
}

export async function sendTemplateTestAction(input: { id: string; locale: string }): Promise<ActionResult<{ email: string }> | { ok: false; error: "rate_limited" }> {
  const g = await adminGuard("admin");
  if (!g.ok) return { ok: false, error: g.error };
  const def = findEmailTemplate(String(input?.id ?? ""));
  if (!def) return { ok: false, error: "not_found" };
  const to = g.cc.user.email;
  if (!to) return { ok: false, error: "not_found" };
  if (!limiter.hit(g.cc.user.id).allowed) return { ok: false, error: "rate_limited" };
  try {
    const mail = def.render(loc(input.locale));
    const res = await sendEmailResult({ to: [to], subject: `[Test] ${mail.subject}`, html: mail.html, text: mail.text });
    if (!res.ok) {
      console.error("[cc-admin] email test failed:", def.id, res.error);
      // The provider's text stays in the server log; the browser gets a fixed code.
      return { ok: false, error: "error", detail: "send_failed" };
    }
    return { ok: true, data: { email: to } };
  } catch (e) {
    console.error("[cc-admin] email test failed:", def.id, e instanceof Error ? e.message : "unknown");
    return { ok: false, error: "error" };
  }
}
