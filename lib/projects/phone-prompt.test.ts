import { describe, expect, it } from "vitest";

import { phonePromptDismissKey, saveLinkAvailable, shouldShowPhonePrompt } from "@/lib/projects/phone-prompt";

describe("shouldShowPhonePrompt", () => {
  it("shows when the profile has no phone", () => {
    expect(shouldShowPhonePrompt({ profilePhone: null, isAccount: false, dismissed: false })).toBe(true);
    expect(shouldShowPhonePrompt({ profilePhone: "  ", isAccount: false, dismissed: false })).toBe(true);
  });

  it("never shows when a phone is set (never asked twice)", () => {
    expect(shouldShowPhonePrompt({ profilePhone: "+97466567410", isAccount: false, dismissed: false })).toBe(false);
  });

  it("not when dismissed in this browser", () => {
    expect(shouldShowPhonePrompt({ profilePhone: null, isAccount: false, dismissed: true })).toBe(false);
  });

  it("not for an account whose profile already has a phone", () => {
    expect(shouldShowPhonePrompt({ profilePhone: "+97466567410", isAccount: true, dismissed: false })).toBe(false);
  });

  it("waits while the profile is loading", () => {
    expect(shouldShowPhonePrompt({ profilePhone: undefined, isAccount: false, dismissed: false })).toBe(false);
  });

  it("dismiss key is per user", () => {
    expect(phonePromptDismissKey("u1")).toBe("gestaltung:phone-prompt-dismissed:u1");
  });
});

describe("saveLinkAvailable", () => {
  const created = "2026-10-08T09:00:00.000Z";
  const at = (min: number) => Date.parse(created) + min * 60_000;
  it("is open for the first hour only", () => {
    expect(saveLinkAvailable(created, at(5))).toBe(true);
    expect(saveLinkAvailable(created, at(59))).toBe(true);
    expect(saveLinkAvailable(created, at(60))).toBe(false);
  });
  it("is closed without a date", () => {
    expect(saveLinkAvailable(null, at(1))).toBe(false);
    expect(saveLinkAvailable("nope", at(1))).toBe(false);
  });
});
