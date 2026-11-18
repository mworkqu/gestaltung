import { describe, expect, it } from "vitest";

import { BUILD_LIMITS, EXAMPLE_BUILD_FILE, buildFileJsonSchema, parseBuildFile } from "./build-file";

const ex = EXAMPLE_BUILD_FILE;
const errorsOf = (raw: unknown) => {
  const r = parseBuildFile(raw);
  return r.ok ? [] : r.errors;
};

describe("parseBuildFile", () => {
  it("accepts the example", () => {
    expect(parseBuildFile(ex).ok).toBe(true);
  });

  it("strips unknown keys, a pasted conversation included", () => {
    const r = parseBuildFile({
      ...ex,
      conversation: [{ role: "user", text: "hi" }],
      summary: { ...ex.summary, transcript: "everything we said" },
      parts: ex.parts.map((p) => ({ ...p, price: 12 })),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).not.toHaveProperty("conversation");
    expect(r.value.summary).not.toHaveProperty("transcript");
    expect(r.value.parts[0]).not.toHaveProperty("price");
  });

  it("trims strings", () => {
    const r = parseBuildFile({ ...ex, name: "   Plant waterer  " });
    expect(r.ok && r.value.name).toBe("Plant waterer");
  });

  it("rejects a 141-character quote", () => {
    expect(errorsOf({ ...ex, requirement_quotes: ["x".repeat(BUILD_LIMITS.short + 1)] })[0]).toMatch(/^requirement_quotes\.0/);
  });

  it("rejects 11 quotes", () => {
    expect(errorsOf({ ...ex, requirement_quotes: Array.from({ length: 11 }, () => "short") }).length).toBeGreaterThan(0);
  });

  it("rejects 25 parts", () => {
    const parts = Array.from({ length: 25 }, () => ({ library_id: "button_6mm" }));
    expect(errorsOf({ ...ex, parts })[0]).toMatch(/^parts/);
  });

  it("rejects 40,001 characters of code", () => {
    const code = { language: "arduino", board: "esp32_c3_mini", source: "x".repeat(40_001) };
    expect(errorsOf({ ...ex, code })[0]).toMatch(/^code\.source/);
  });

  it("rejects a 2,001-character cad prompt", () => {
    expect(errorsOf({ ...ex, cad: { prompt: "x".repeat(2_001) } })[0]).toMatch(/^cad\.prompt/);
  });

  it("rejects cad with neither a prompt nor openscad", () => {
    expect(errorsOf({ ...ex, cad: {} }).join(" ")).toMatch(/cad needs a prompt/);
  });

  it("errors are path + message and short", () => {
    const errs = errorsOf({ version: 2 });
    expect(errs.length).toBeGreaterThan(0);
    for (const e of errs) expect(e.length).toBeLessThanOrEqual(200);
  });
});

describe("buildFileJsonSchema", () => {
  it("describes parts", () => {
    const s = buildFileJsonSchema() as { properties?: Record<string, unknown> };
    expect(s.properties?.parts).toBeDefined();
  });
});
