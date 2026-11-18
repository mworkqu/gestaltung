import { describe, expect, it } from "vitest";

import { HELP_CATEGORIES, normalizeHelpCategory } from "./categories";

describe("help categories", () => {
  it("has six categories with unique slugs (32 articles)", () => {
    expect(HELP_CATEGORIES).toHaveLength(6);
    const all = HELP_CATEGORIES.flatMap((c) => c.slugs);
    expect(new Set(all).size).toBe(all.length);
    expect(all).toHaveLength(32);
    for (const s of all) expect(s).toMatch(/^[a-z0-9-]+$/);
  });

  it("normalizes both spellings", () => {
    expect(normalizeHelpCategory("files_export")).toBe("files-and-export");
    expect(normalizeHelpCategory("files-and-export")).toBe("files-and-export");
    expect(normalizeHelpCategory("training_payment")).toBe("training-and-payment");
    expect(normalizeHelpCategory("competition")).toBe("competition");
    expect(normalizeHelpCategory("nope")).toBeNull();
    expect(normalizeHelpCategory(null)).toBeNull();
  });
});
