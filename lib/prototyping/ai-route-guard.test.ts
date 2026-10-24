import { describe, expect, it } from "vitest";

import { createRateLimiter } from "@/lib/rate-limit";

import { BRIEF_CHAT_LIMITS, BriefChatBody, rateLimited, routeRate } from "./ai-route-guard";

const PID = "0b9a3c1e-7f2d-4c55-9a1e-1234567890ab";

describe("BriefChatBody", () => {
  it("keeps the former slices: last 16 messages × 1,500 chars, brief 6,000", () => {
    const messages = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", text: "x".repeat(2000) }));
    const r = BriefChatBody.parse({ projectId: PID, locale: "ar", brief: "b".repeat(7000), messages });
    expect(r.messages).toHaveLength(BRIEF_CHAT_LIMITS.messages);
    expect(r.messages.every((m) => m.text.length === BRIEF_CHAT_LIMITS.text)).toBe(true);
    expect(r.brief).toHaveLength(BRIEF_CHAT_LIMITS.brief);
    expect(r.locale).toBe("ar");
    expect(r.projectId).toBe(PID);
  });

  it("defaults like the old route: English, empty brief, no messages, bad project id → null", () => {
    expect(BriefChatBody.parse({ projectId: "not-a-uuid", locale: "fr" })).toEqual({
      projectId: null,
      locale: "en",
      brief: "",
      messages: [],
      turnstileToken: null,
    });
  });

  it("drops unknown message keys and carries the Turnstile token", () => {
    const r = BriefChatBody.parse({ messages: [{ role: "user", text: "hi", extra: 1 }], turnstileToken: "tok" });
    expect(r.messages).toEqual([{ role: "user", text: "hi" }]);
    expect(r.turnstileToken).toBe("tok");
  });

  it("rejects wrong shapes and oversized input", () => {
    expect(BriefChatBody.safeParse(null).success).toBe(false);
    expect(BriefChatBody.safeParse({ brief: 42 }).success).toBe(false);
    expect(BriefChatBody.safeParse({ messages: [{ role: "system", text: "x" }] }).success).toBe(false);
    expect(BriefChatBody.safeParse({ messages: "hi" }).success).toBe(false);
    expect(BriefChatBody.safeParse({ brief: "b".repeat(20_001) }).success).toBe(false);
    expect(BriefChatBody.safeParse({ messages: Array.from({ length: 65 }, () => ({ role: "user", text: "x" })) }).success).toBe(false);
  });
});

describe("routeRate", () => {
  const limiters = () => ({
    user: createRateLimiter({ limit: 2, windowMs: 60_000 }),
    ip: createRateLimiter({ limit: 3, windowMs: 60_000 }),
  });

  it("limits each user id", () => {
    const l = limiters();
    const me = { userId: "u1", anonymous: false, ip: "1.1.1.1" };
    expect(routeRate(l, me, 0).allowed).toBe(true);
    expect(routeRate(l, me, 1).allowed).toBe(true);
    const third = routeRate(l, me, 2);
    expect(third.allowed).toBe(false);
    expect(third.retryAfterSec).toBeGreaterThan(0);
    expect(routeRate(l, { ...me, userId: "u2" }, 3).allowed).toBe(true);
    expect(routeRate(l, me, 60_001).allowed).toBe(true);
  });

  it("limits anonymous sessions per IP too (fresh guest sessions do not reset it)", () => {
    const l = limiters();
    const guest = (n: number) => ({ userId: `g${n}`, anonymous: true, ip: "9.9.9.9" });
    expect([0, 1, 2].map((n) => routeRate(l, guest(n), n).allowed)).toEqual([true, true, true]);
    expect(routeRate(l, guest(3), 3).allowed).toBe(false);
    // Signed-in users on the same IP are not counted per IP.
    expect(routeRate(l, { userId: "real", anonymous: false, ip: "9.9.9.9" }, 4).allowed).toBe(true);
  });

  it("answers 429 with Retry-After", async () => {
    const res = rateLimited(42);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("42");
    expect(await res.json()).toEqual({ error: "rate_limited" });
  });
});
