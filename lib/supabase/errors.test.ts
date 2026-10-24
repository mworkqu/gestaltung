import { describe, expect, it } from "vitest";

import { isMissingColumn, isMissingFunction, isMissingRelation, isMissingSchemaObject } from "@/lib/supabase/errors";

// The legacy predicate in app/[locale]/dashboard/ai-costs/format.ts; the new
// helpers together must agree with it on every code.
const legacy = (error: { code?: string } | null | undefined) =>
  !!error && ["PGRST202", "42883", "42703", "42P01", "PGRST205"].includes(error.code ?? "");

describe("missing-schema detection", () => {
  it("classifies each code", () => {
    expect(isMissingRelation({ code: "42P01" })).toBe(true);
    expect(isMissingRelation({ code: "PGRST205" })).toBe(true);
    expect(isMissingFunction({ code: "42883" })).toBe(true);
    expect(isMissingFunction({ code: "PGRST202" })).toBe(true);
    expect(isMissingColumn({ code: "42703" })).toBe(true);

    expect(isMissingRelation({ code: "42883" })).toBe(false);
    expect(isMissingFunction({ code: "42P01" })).toBe(false);
    expect(isMissingColumn({ code: "42P01" })).toBe(false);
  });

  it("isMissingSchemaObject equals the old needsMigration for every code", () => {
    const codes = ["PGRST202", "42883", "42703", "42P01", "PGRST205", "23505", "42501", "PGRST116", "PGRST204", "", "pgrst205"];
    for (const code of codes) expect(isMissingSchemaObject({ code })).toBe(legacy({ code }));
    expect(isMissingSchemaObject({})).toBe(legacy({}));
  });

  it("accepts unknown input without throwing", () => {
    for (const v of [null, undefined, "42P01", 42703, [], {}, { code: 42703 }, { code: null }, () => 1, true]) {
      expect(isMissingRelation(v)).toBe(false);
      expect(isMissingFunction(v)).toBe(false);
      expect(isMissingColumn(v)).toBe(false);
      expect(isMissingSchemaObject(v)).toBe(false);
    }
  });

  it("works on real Error objects carrying a code", () => {
    const e = Object.assign(new Error("relation does not exist"), { code: "42P01" });
    expect(isMissingRelation(e)).toBe(true);
  });
});
