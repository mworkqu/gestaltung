import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  TURNSTILE_FIELD,
  TURNSTILE_HEADER,
  TURNSTILE_VERIFY_URL,
  clientIp,
  parseTurnstileSettings,
  readTurnstileToken,
  turnstileRequired,
  turnstileWidgetOn,
  verifyTurnstile,
} from "./turnstile";

describe("parseTurnstileSettings", () => {
  it("is OFF unless enabled is exactly true", () => {
    expect(parseTurnstileSettings({ enabled: true })).toEqual({ enabled: true });
    for (const raw of [null, undefined, {}, { enabled: false }, { enabled: "true" }, { enabled: 1 }, "on", []]) {
      expect(parseTurnstileSettings(raw)).toEqual({ enabled: false });
    }
  });
});

describe("turnstileWidgetOn / turnstileRequired", () => {
  const on = { enabled: true };
  const off = { enabled: false };
  it("widget needs the switch and a site key", () => {
    expect(turnstileWidgetOn(on, "1x00000000000000000000AA")).toBe(true);
    expect(turnstileWidgetOn(off, "1x00000000000000000000AA")).toBe(false);
    expect(turnstileWidgetOn(on, "")).toBe(false);
    expect(turnstileWidgetOn(on, "   ")).toBe(false);
    expect(turnstileWidgetOn(on, null)).toBe(false);
    expect(turnstileWidgetOn(null, "key")).toBe(false);
  });
  it("server check needs the switch AND both keys", () => {
    const keys = { siteKey: "site", secret: "secret" };
    expect(turnstileRequired(on, keys)).toBe(true);
    expect(turnstileRequired(off, keys)).toBe(false);
    expect(turnstileRequired(on, { siteKey: "site", secret: "" })).toBe(false);
    expect(turnstileRequired(on, { siteKey: "", secret: "secret" })).toBe(false);
    expect(turnstileRequired(on, {})).toBe(false);
  });
});

describe("readTurnstileToken", () => {
  it("reads FormData, Headers and JSON bodies", () => {
    const fd = new FormData();
    fd.set(TURNSTILE_FIELD, " tok-1 ");
    expect(readTurnstileToken(fd)).toBe("tok-1");
    expect(readTurnstileToken(new Headers({ [TURNSTILE_HEADER]: "tok-2" }))).toBe("tok-2");
    expect(readTurnstileToken({ turnstileToken: "tok-3" })).toBe("tok-3");
    expect(readTurnstileToken({ [TURNSTILE_FIELD]: "tok-4" })).toBe("tok-4");
  });
  it("null when absent, empty, not a string or too long", () => {
    expect(readTurnstileToken(null)).toBeNull();
    expect(readTurnstileToken(new FormData())).toBeNull();
    expect(readTurnstileToken(new Headers())).toBeNull();
    expect(readTurnstileToken({ turnstileToken: "  " })).toBeNull();
    expect(readTurnstileToken({ turnstileToken: 42 })).toBeNull();
    expect(readTurnstileToken({ turnstileToken: "x".repeat(2049) })).toBeNull();
  });
});

describe("clientIp", () => {
  it("takes the first x-forwarded-for hop, else x-real-ip", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }))).toBe("1.2.3.4");
    expect(clientIp(new Headers({ "x-real-ip": "5.6.7.8" }))).toBe("5.6.7.8");
    expect(clientIp(new Headers())).toBeNull();
  });
});

describe("verifyTurnstile", () => {
  const fakeFetch = (body: unknown, ok = true) => vi.fn(async () => ({ ok, json: async () => body }));

  it("posts secret, response and remoteip to siteverify", async () => {
    const f = fakeFetch({ success: true, "error-codes": [] });
    const r = await verifyTurnstile("tok", "1.2.3.4", { secret: "sec", fetchImpl: f });
    expect(r).toEqual({ ok: true, codes: [] });
    const [url, init] = f.mock.calls[0] as unknown as [string, { method: string; body: string }];
    expect(url).toBe(TURNSTILE_VERIFY_URL);
    expect(init.method).toBe("POST");
    const params = new URLSearchParams(init.body);
    expect(params.get("secret")).toBe("sec");
    expect(params.get("response")).toBe("tok");
    expect(params.get("remoteip")).toBe("1.2.3.4");
  });

  it("omits remoteip when unknown", async () => {
    const f = fakeFetch({ success: true });
    await verifyTurnstile("tok", null, { secret: "sec", fetchImpl: f });
    const [, init] = f.mock.calls[0] as unknown as [string, { body: string }];
    expect(new URLSearchParams(init.body).has("remoteip")).toBe(false);
  });

  it("fails closed: refused, HTTP error, network error, missing token", async () => {
    const refused = fakeFetch({ success: false, "error-codes": ["invalid-input-response"] });
    expect(await verifyTurnstile("tok", null, { secret: "s", fetchImpl: refused })).toEqual({
      ok: false,
      codes: ["invalid-input-response"],
    });
    expect((await verifyTurnstile("tok", null, { secret: "s", fetchImpl: fakeFetch({}, false) })).ok).toBe(false);
    const boom = vi.fn(async () => {
      throw new Error("down");
    });
    expect(await verifyTurnstile("tok", null, { secret: "s", fetchImpl: boom })).toEqual({
      ok: false,
      codes: ["network-error"],
    });
    const never = fakeFetch({ success: true });
    expect((await verifyTurnstile("", null, { secret: "s", fetchImpl: never })).ok).toBe(false);
    expect(never).not.toHaveBeenCalled();
  });
});

describe("0055 seed", () => {
  it("seeds the switch OFF, re-runnable", () => {
    const sql = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/0055_turnstile_and_cleanup.sql"), "utf8");
    expect(sql).toMatch(/values \('turnstile', '\{"enabled": false\}'::jsonb\)\s*on conflict \(key\) do nothing/);
  });
});
