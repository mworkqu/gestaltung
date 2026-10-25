import { describe, expect, it } from "vitest";
import { isAuthorizedCron } from "./cron";
import { isAuthorizedCron as reExported } from "@/lib/notifications/links";

describe("isAuthorizedCron", () => {
  it("rejects when the secret is unset or empty", () => {
    expect(isAuthorizedCron("Bearer anything", undefined)).toBe(false);
    expect(isAuthorizedCron("Bearer ", "")).toBe(false);
    expect(isAuthorizedCron("Bearer undefined", undefined)).toBe(false);
  });
  it("rejects a missing header", () => {
    expect(isAuthorizedCron(null, "s3cret")).toBe(false);
    expect(isAuthorizedCron(undefined, "s3cret")).toBe(false);
  });
  it("rejects a wrong secret or scheme", () => {
    expect(isAuthorizedCron("Bearer wrong", "s3cret")).toBe(false);
    expect(isAuthorizedCron("Bearer s3cret2", "s3cret")).toBe(false);
    expect(isAuthorizedCron("s3cret", "s3cret")).toBe(false);
    expect(isAuthorizedCron("Basic s3cret", "s3cret")).toBe(false);
  });
  it("accepts the exact bearer secret", () => {
    expect(isAuthorizedCron("Bearer s3cret", "s3cret")).toBe(true);
  });
  it("rejects a header of a different length without throwing", () => {
    expect(isAuthorizedCron("Bearer s3cret-and-more", "s3cret")).toBe(false);
    expect(isAuthorizedCron("Bearer s", "s3cret")).toBe(false);
    expect(isAuthorizedCron("B", "s3cret")).toBe(false);
  });
  it("is still importable from lib/notifications/links", () => {
    expect(reExported).toBe(isAuthorizedCron);
  });
});
