import { afterEach, describe, expect, it, vi } from "vitest";

import { dayStart, guardThreshold, nextReset, PROVIDERS, providerLimits } from "./limits";

afterEach(() => vi.unstubAllEnvs());

const iso = (d: Date) => d.toISOString();

describe("providerLimits", () => {
  it("Gemini: 500 requests/day, no token cap, Pacific day", () => {
    const l = providerLimits("gemini");
    expect(l).toMatchObject({ requestsPerDay: 500, tokensPerDay: null, audioSecondsPerDay: null, resetTimeZone: "America/Los_Angeles" });
  });

  it("Groq: 2000 requests + 28800 audio seconds/day, UTC day", () => {
    const l = providerLimits("groq");
    expect(l).toMatchObject({ requestsPerDay: 2000, tokensPerDay: null, audioSecondsPerDay: 28800, resetTimeZone: "UTC" });
  });

  it("lists both providers", () => {
    expect(PROVIDERS).toEqual(["gemini", "groq"]);
  });

  it("env overrides apply; junk or negative values fall back to the default", () => {
    vi.stubEnv("AI_LIMIT_GEMINI_REQUESTS", "250");
    vi.stubEnv("AI_LIMIT_GEMINI_TOKENS", "1000000");
    vi.stubEnv("AI_LIMIT_GROQ_REQUESTS", "abc");
    vi.stubEnv("AI_LIMIT_GROQ_AUDIO_SECONDS", "-5");
    expect(providerLimits("gemini")).toMatchObject({ requestsPerDay: 250, tokensPerDay: 1_000_000 });
    expect(providerLimits("groq")).toMatchObject({ requestsPerDay: 2000, audioSecondsPerDay: 28800 });
  });

  it("the reset time zone can be overridden", () => {
    vi.stubEnv("AI_RESET_TZ_GROQ", " Asia/Qatar ");
    expect(providerLimits("groq").resetTimeZone).toBe("Asia/Qatar");
  });
});

describe("guardThreshold", () => {
  it("defaults to 0.8", () => {
    expect(guardThreshold()).toBe(0.8);
  });

  it("takes the env value, capped at 1, and ignores junk", () => {
    vi.stubEnv("AI_GUARD_THRESHOLD", "0.5");
    expect(guardThreshold()).toBe(0.5);
    vi.stubEnv("AI_GUARD_THRESHOLD", "7");
    expect(guardThreshold()).toBe(1);
    vi.stubEnv("AI_GUARD_THRESHOLD", "nope");
    expect(guardThreshold()).toBe(0.8);
    vi.stubEnv("AI_GUARD_THRESHOLD", "-1");
    expect(guardThreshold()).toBe(0.8);
  });
});

describe("dayStart", () => {
  it("UTC (Groq): midnight UTC", () => {
    expect(iso(dayStart("UTC", new Date("2026-10-22T13:45:10.250Z")))).toBe("2026-10-22T00:00:00.000Z");
    expect(iso(dayStart("UTC", new Date("2026-10-22T00:00:00.000Z")))).toBe("2026-10-22T00:00:00.000Z");
  });

  it("Pacific (Gemini), daylight time: midnight PDT = 07:00 UTC", () => {
    expect(iso(dayStart("America/Los_Angeles", new Date("2026-10-22T12:00:00Z")))).toBe("2026-10-22T07:00:00.000Z");
    // 06:59 UTC is still 23:59 PDT of the previous Pacific day
    expect(iso(dayStart("America/Los_Angeles", new Date("2026-10-22T06:59:00Z")))).toBe("2026-10-21T07:00:00.000Z");
  });

  it("Pacific, standard time: midnight PST = 08:00 UTC", () => {
    expect(iso(dayStart("America/Los_Angeles", new Date("2026-01-15T12:00:00Z")))).toBe("2026-01-15T08:00:00.000Z");
  });
});

describe("nextReset", () => {
  it("is 24 h after the day start on an ordinary day", () => {
    expect(iso(nextReset("UTC", new Date("2026-10-22T13:00:00Z")))).toBe("2026-10-23T00:00:00.000Z");
    expect(iso(nextReset("America/Los_Angeles", new Date("2026-10-22T12:00:00Z")))).toBe("2026-10-23T07:00:00.000Z");
  });

  it("lands on the next local midnight across the US fall-back (2026-11-01, 25 h day)", () => {
    // Day starts 00:00 PDT (07:00Z); the next midnight is 00:00 PST (08:00Z).
    expect(iso(nextReset("America/Los_Angeles", new Date("2026-11-01T12:00:00Z")))).toBe("2026-11-02T08:00:00.000Z");
  });

  it("lands on the next local midnight across the spring-forward (2026-03-08, 23 h day)", () => {
    // Day starts 00:00 PST (08:00Z); the next midnight is 00:00 PDT (07:00Z).
    expect(iso(nextReset("America/Los_Angeles", new Date("2026-03-08T20:00:00Z")))).toBe("2026-03-09T07:00:00.000Z");
  });
});
