import { describe, expect, it } from "vitest";

import { moveTestimonial, nextSort, parseTestimonialInput, publicTestimonials, sortTestimonials, type TestimonialRow } from "./testimonials";

const row = (id: string, sort: number, pub = true, over: Partial<TestimonialRow> = {}): TestimonialRow => ({
  id,
  quote_en: `q-${id}`,
  quote_ar: `ق-${id}`,
  name_en: `n-${id}`,
  name_ar: `ا-${id}`,
  role_en: null,
  role_ar: null,
  sort,
  is_published: pub,
  ...over,
});

describe("parseTestimonialInput", () => {
  it("requires quote and name in both languages", () => {
    const base = { quote_en: " Great ", quote_ar: "ممتاز", name_en: "Sara", name_ar: "سارة", role_en: "", role_ar: "" };
    const ok = parseTestimonialInput(base);
    expect(ok.ok && ok.value.quote_en).toBe("Great");
    expect(parseTestimonialInput({ ...base, quote_ar: " " })).toEqual({ ok: false, field: "quote_ar" });
    expect(parseTestimonialInput({ ...base, name_en: "" })).toEqual({ ok: false, field: "name_en" });
    expect(parseTestimonialInput(null)).toEqual({ ok: false, field: "quote_en" });
  });
  it("caps lengths", () => {
    const r = parseTestimonialInput({ quote_en: "x".repeat(900), quote_ar: "y", name_en: "n", name_ar: "n" });
    expect(r.ok && r.value.quote_en.length).toBe(600);
  });
});

describe("ordering", () => {
  it("sorts by sort then id", () => {
    expect(sortTestimonials([row("b", 2), row("a", 2), row("c", 1)]).map((r) => r.id)).toEqual(["c", "a", "b"]);
  });
  it("appends at the end", () => {
    expect(nextSort([])).toBe(10);
    expect(nextSort([row("a", 30), row("b", 10)])).toBe(40);
  });
  it("moves one step and renumbers", () => {
    const rows = [row("a", 10), row("b", 20), row("c", 30)];
    expect(moveTestimonial(rows, "c", "up")).toEqual([
      { id: "c", sort: 20 },
      { id: "b", sort: 30 },
    ]);
    expect(moveTestimonial(rows, "a", "up")).toEqual([]);
    expect(moveTestimonial(rows, "c", "down")).toEqual([]);
    expect(moveTestimonial(rows, "zz", "up")).toEqual([]);
  });
  it("heals ties", () => {
    const rows = [row("a", 0), row("b", 0)];
    expect(moveTestimonial(rows, "b", "up")).toEqual([
      { id: "b", sort: 10 },
      { id: "a", sort: 20 },
    ]);
  });
});

describe("publicTestimonials", () => {
  const rows = [row("a", 20), row("b", 10), row("c", 5, false), row("d", 30, true, { quote_ar: "", role_en: "Student", role_ar: "طالب" })];
  it("shows published rows in order for the locale", () => {
    expect(publicTestimonials(rows, "en").map((r) => r.id)).toEqual(["b", "a", "d"]);
    expect(publicTestimonials(rows, "ar")[0].quote).toBe("ق-b");
  });
  it("falls back to the other language and exposes the role", () => {
    const d = publicTestimonials(rows, "ar").find((r) => r.id === "d")!;
    expect(d.quote).toBe("q-d");
    expect(d.role).toBe("طالب");
  });
  it("is empty when nothing is published", () => {
    expect(publicTestimonials([row("a", 1, false)], "en")).toEqual([]);
  });
});
