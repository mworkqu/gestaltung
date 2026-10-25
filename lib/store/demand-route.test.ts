import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const sendEmail = vi.fn();
const checkTurnstile = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc, from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) }),
}));
vi.mock("@/lib/email", () => ({ OWNER_EMAIL: "owner@example.com", sendEmail: (...a: unknown[]) => sendEmail(...a) }));
vi.mock("@/lib/email/lead-email", () => ({
  leadsDashboardUrl: () => "https://example.com/dash",
  renderOwnerEmail: () => ({ html: "", text: "" }),
}));
vi.mock("@/lib/turnstile-server", () => ({ checkTurnstile: (...a: unknown[]) => checkTurnstile(...a) }));

import { POST } from "@/app/api/demand/route";

let ipCounter = 0;
function req(body: unknown, ip: string, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/demand", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip, ...headers },
    body: JSON.stringify(body),
  });
}
const freshIp = () => `10.0.0.${++ipCounter}`;

beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ error: null, data: null });
  sendEmail.mockReset().mockResolvedValue(true);
  checkTurnstile.mockReset().mockResolvedValue({ ok: true, enforced: false });
});

describe("POST /api/demand", () => {
  it("records a view beacon without any Turnstile check", async () => {
    const res = await POST(req({ kind: "view", partId: "11111111-2222-4333-8444-555555555555" }, freshIp()));
    expect(res.status).toBe(200);
    expect(checkTurnstile).not.toHaveBeenCalled();
  });

  it("answers 403 captcha_failed for a request when Turnstile fails, and sends no email", async () => {
    checkTurnstile.mockResolvedValue({ ok: false, codes: ["missing-input-response"] });
    const res = await POST(req({ kind: "request", searchTerm: "widget", email: "a@b.co" }, freshIp()));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "captcha_failed" });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("passes the header token, or the body token, to checkTurnstile", async () => {
    await POST(req({ kind: "request", searchTerm: "widget", email: "a@b.co" }, freshIp(), { "x-turnstile-token": "hdr" }));
    expect(checkTurnstile.mock.calls[0]![1]).toBe("hdr");
    await POST(req({ kind: "request", searchTerm: "widget", email: "a@b.co", turnstileToken: "body" }, freshIp()));
    expect(checkTurnstile.mock.calls[1]![1]).toBe("body");
  });

  it("limits request kinds per IP with Retry-After, leaving other IPs alone", async () => {
    const ip = freshIp();
    const body = { kind: "request", searchTerm: "widget", email: "a@b.co" };
    for (let i = 0; i < 10; i++) expect((await POST(req(body, ip))).status).toBe(200);
    const limited = await POST(req(body, ip));
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await POST(req(body, freshIp()))).status).toBe(200);
  });

  it("keeps the view beacon generous: 100 from one IP all succeed", async () => {
    const ip = freshIp();
    for (let i = 0; i < 100; i++) {
      expect((await POST(req({ kind: "view", partId: "11111111-2222-4333-8444-555555555555" }, ip))).status).toBe(200);
    }
  });

  it("keeps the 400 for an unknown kind", async () => {
    expect((await POST(req({ kind: "nope" }, freshIp()))).status).toBe(400);
  });
});
