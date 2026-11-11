import { describe, expect, it } from "vitest";

import { profileCompleteness } from "./completeness";

describe("profileCompleteness", () => {
  it("is 0 for no profile", () => {
    const r = profileCompleteness(null);
    expect(r.percent).toBe(0);
    expect(r.missing).toHaveLength(9);
  });
  it("counts filled fields and ignores blank strings", () => {
    const r = profileCompleteness({ full_name: "Sara", phone: "  ", date_of_birth: "2008-01-01", institution: "x" });
    expect(r.percent).toBe(33);
    expect(r.missing).toContain("phone");
    expect(r.missing).not.toContain("full_name");
  });
  it("is 100 when everything is filled", () => {
    const all = Object.fromEntries(
      ["full_name", "full_name_ar", "phone", "date_of_birth", "institution", "study_level", "cad_software_used", "cad_experience", "has_windows_pc"].map((k) => [k, "x"]),
    );
    expect(profileCompleteness(all).percent).toBe(100);
  });
});
