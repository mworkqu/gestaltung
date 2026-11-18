import { describe, expect, it } from "vitest";

import { checkEntry } from "../admin/override-editor";
import { isOverrideKey } from "../content/overrides";
import { POLICIES_APPROVED_KEY, arePoliciesApproved } from "./approval";

describe("arePoliciesApproved", () => {
  it("uses a valid override key", () => expect(isOverrideKey(POLICIES_APPROVED_KEY)).toBe(true));
  it("is draft when nothing is saved or the map is missing", () => {
    expect(arePoliciesApproved(null)).toBe(false);
    expect(arePoliciesApproved(undefined)).toBe(false);
    expect(arePoliciesApproved(new Map())).toBe(false);
  });
  it("is approved only for the value 1", () => {
    expect(arePoliciesApproved(new Map([[POLICIES_APPROVED_KEY, "1"]]))).toBe(true);
    expect(arePoliciesApproved(new Map([[POLICIES_APPROVED_KEY, " 1 "]]))).toBe(true);
    expect(arePoliciesApproved(new Map([[POLICIES_APPROVED_KEY, "true"]]))).toBe(false);
    expect(arePoliciesApproved(new Map([[POLICIES_APPROVED_KEY, "0"]]))).toBe(false);
    expect(arePoliciesApproved(new Map([["flag:other", "1"]]))).toBe(false);
  });
});

describe("flag keys in the override editor", () => {
  it("accepts the approval flag with 1 or empty, rejects other values and unknown flags", () => {
    const ctx = { messages: {} };
    expect(checkEntry({ key: POLICIES_APPROVED_KEY, en: "1", ar: "1" }, ctx)).toBeNull();
    expect(checkEntry({ key: POLICIES_APPROVED_KEY, en: "", ar: "" }, ctx)).toBeNull();
    expect(checkEntry({ key: POLICIES_APPROVED_KEY, en: "yes", ar: "" }, ctx)).toBe("bad_key");
    expect(checkEntry({ key: "flag:something.else", en: "1", ar: "1" }, ctx)).toBe("unknown_flag");
  });
});
