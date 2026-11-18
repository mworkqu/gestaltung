import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { CC_STORAGE_QUOTA_BYTES, CC_UPLOADS_PER_DAY, isOverQuota } from "./quota";

describe("storage quota (SR-M7)", () => {
  it("is over only when the stored total passes the quota", () => {
    expect(isOverQuota(0)).toBe(false);
    expect(isOverQuota(CC_STORAGE_QUOTA_BYTES)).toBe(false);
    expect(isOverQuota(CC_STORAGE_QUOTA_BYTES + 1)).toBe(true);
    expect(isOverQuota(Number.NaN)).toBe(false);
    expect(isOverQuota(-5)).toBe(false);
    expect(isOverQuota(11, 10)).toBe(true);
  });

  it("matches the numbers in migration 0087 (Storage insert policy)", () => {
    const sql = readFileSync(fileURLToPath(new URL("../../../supabase/migrations/0087_cc_security_2.sql", import.meta.url)), "utf8");
    expect(sql).toContain(`>= ${CC_STORAGE_QUOTA_BYTES}`);
    expect(sql).toContain(`>= ${CC_UPLOADS_PER_DAY}`);
  });
});
