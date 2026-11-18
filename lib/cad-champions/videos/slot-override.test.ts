import { describe, expect, it } from "vitest";

import { resolveSlotRef } from "./slot-override";

const base = { provider: "placeholder", providerId: "" } as const;

describe("resolveSlotRef", () => {
  it("keeps the registry slot without an override", () => {
    expect(resolveSlotRef(base, null)).toEqual(base);
    expect(resolveSlotRef(base, "  ")).toEqual(base);
  });
  it("uses a YouTube override", () => {
    expect(resolveSlotRef(base, "youtube:dQw4w9WgXcQ")).toEqual({ provider: "youtube", providerId: "dQw4w9WgXcQ" });
  });
  it("uses a Bunny GUID override", () => {
    const g = "0f8fad5b-d9cb-469f-a165-70867728950e";
    expect(resolveSlotRef(base, g)).toEqual({ provider: "bunny", providerId: g });
  });
  it("ignores a malformed override", () => {
    const reg = { provider: "youtube", providerId: "abcdefghijk" } as const;
    expect(resolveSlotRef(reg, "youtube:short")).toEqual(reg);
    expect(resolveSlotRef(reg, "nonsense")).toEqual(reg);
  });
});
