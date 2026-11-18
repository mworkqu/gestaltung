import { describe, expect, it } from "vitest";

import { callFingerprint } from "./call-fingerprint";

const base = {
  step: "vision",
  system: "You are a strict reviewer.",
  prompt: "Does this look like a plant waterer?",
  schema: { type: "OBJECT", properties: { score: { type: "INTEGER" } } },
};

describe("callFingerprint", () => {
  it("is the same for the same request and stable across calls", () => {
    const a = callFingerprint(base);
    expect(callFingerprint({ ...base })).toBe(a);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
  });

  it("changes with anything the model would see", () => {
    const a = callFingerprint(base);
    expect(callFingerprint({ ...base, step: "product" })).not.toBe(a);
    expect(callFingerprint({ ...base, system: `${base.system} ` })).not.toBe(a);
    expect(callFingerprint({ ...base, prompt: "Check round 2." })).not.toBe(a);
    expect(callFingerprint({ ...base, schema: { type: "OBJECT" } })).not.toBe(a);
    expect(callFingerprint({ ...base, model: "gemini-pro" })).not.toBe(a);
  });

  it("covers the pictures, so another render is another question", () => {
    const img = { mimeType: "image/png", data: "AAAA" };
    const one = callFingerprint({ ...base, images: [img] });
    expect(one).not.toBe(callFingerprint(base));
    expect(callFingerprint({ ...base, images: [{ ...img, data: "BBBB" }] })).not.toBe(one);
    expect(callFingerprint({ ...base, images: [img, img] })).not.toBe(one);
    expect(callFingerprint({ ...base, images: [img] })).toBe(one);
  });

  it("cannot be confused by field boundaries", () => {
    const a = callFingerprint({ ...base, system: "ab", prompt: "c" });
    const b = callFingerprint({ ...base, system: "a", prompt: "bc" });
    expect(a).not.toBe(b);
  });
});
