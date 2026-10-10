import { describe, expect, it } from "vitest";

import { DEFAULT_SPEC, emptyStudioDoc } from "../schema";
import { DOC_MAX_BYTES, docBytes, isMissingStudioColumn } from "./doc";
import {
  callErrorStatus, cadRpcError, creditDenied, DocPutBody, EnclosureBody, PickBody, SpecBody, versionFromRegens, wiringKey,
} from "./http";

const ID = "6b5907f2-c957-43f9-bce8-42e73beeff33";

describe("bodies", () => {
  it("SpecBody needs a uuid; locale falls back to en", () => {
    expect(SpecBody.safeParse({ projectId: "nope" }).success).toBe(false);
    const ok = SpecBody.parse({ projectId: ID, locale: "fr" });
    expect(ok.locale).toBe("en");
    expect(ok.messages).toEqual([]);
  });

  it("PickBody clamps any spec to a valid one, quantity 1", () => {
    const b = PickBody.parse({ projectId: ID, locale: "ar", spec: { name: "Lamp", quantity: 500, use: "space" } });
    expect(b.spec.quantity).toBe(1);
    expect(b.spec.use).toBe("desk");
    expect(b.locale).toBe("ar");
  });

  it("EnclosureBody requires a bbox", () => {
    expect(EnclosureBody.safeParse({ projectId: ID, spec: DEFAULT_SPEC }).success).toBe(false);
    expect(EnclosureBody.safeParse({ projectId: ID, spec: DEFAULT_SPEC, bbox: { w: 50, d: 40, h: 20 } }).success).toBe(true);
  });

  it("DocPutBody validates the whole StudioDoc", () => {
    expect(DocPutBody.safeParse({ projectId: ID, doc: emptyStudioDoc(), version: 0 }).success).toBe(true);
    expect(DocPutBody.safeParse({ projectId: ID, doc: { ...emptyStudioDoc(), version: 2 }, version: 0 }).success).toBe(false);
  });
});

describe("status mapping", () => {
  it("model errors", () => {
    expect(callErrorStatus("paused")).toBe(429);
    expect(callErrorStatus("rate_limited")).toBe(429);
    expect(callErrorStatus("invalid")).toBe(502);
    expect(callErrorStatus("unavailable")).toBe(503);
  });

  it("credits like /api/netlist", () => {
    expect(creditDenied({ allowed: true, reason: null })).toBeNull();
    expect(creditDenied({ allowed: false, reason: "sign_in" })).toEqual({ status: 401, error: "sign_in" });
    expect(creditDenied({ allowed: false, reason: "no_credits" })).toEqual({ status: 402, error: "no_credits" });
    expect(creditDenied({ allowed: false, reason: "not_ready" })).toEqual({ status: 503, error: "not_ready" });
  });

  it("cad RPC errors", () => {
    expect(cadRpcError("P0001: no_credits")).toEqual({ status: 402, error: "no_credits" });
    expect(cadRpcError("too_many_failed")).toEqual({ status: 429, error: "too_many_failed" });
    expect(cadRpcError("boom")).toEqual({ status: 500, error: "failed" });
  });

  it("3 versions per credit", () => {
    expect(versionFromRegens(2)).toEqual({ version: 1, versionsLeft: 2 });
    expect(versionFromRegens(1)).toEqual({ version: 2, versionsLeft: 1 });
    expect(versionFromRegens(0)).toEqual({ version: 3, versionsLeft: 0 });
    expect(versionFromRegens(undefined)).toEqual({ version: 3, versionsLeft: 0 });
  });
});

describe("doc helpers", () => {
  it("detects the missing 0068 column", () => {
    expect(isMissingStudioColumn({ code: "42703", message: 'column projects.studio does not exist' })).toBe(true);
    expect(isMissingStudioColumn({ code: "PGRST204", message: "Could not find the 'studio_version' column of 'projects' in the schema cache" })).toBe(true);
    expect(isMissingStudioColumn({ code: "42501", message: "permission denied" })).toBe(false);
    expect(isMissingStudioColumn(null)).toBe(false);
  });

  it("size cap is 256 kB", () => {
    expect(DOC_MAX_BYTES).toBe(262144);
    expect(docBytes(emptyStudioDoc())).toBeLessThan(DOC_MAX_BYTES);
  });

  it("wiringKey ignores order but not changes", () => {
    const a = [{ partId: "esp32_devkit", instanceId: "esp32_devkit_1" }, { partId: "dht22", instanceId: "dht22_1" }];
    expect(wiringKey(DEFAULT_SPEC, a)).toBe(wiringKey(DEFAULT_SPEC, [...a].reverse()));
    expect(wiringKey(DEFAULT_SPEC, a)).not.toBe(wiringKey({ ...DEFAULT_SPEC, power: "battery" }, a));
  });
});
