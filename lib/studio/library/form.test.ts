import { describe, expect, it } from "vitest";

import { LIBRARY } from "./index";
import { draftToPart, emptyDraft, parseCommaList, parseNumber, parseParams, partToDraft, plainCheck } from "./form";
import { checkLibraryPart } from "./merge";

describe("form parsing helpers", () => {
  it("parseCommaList trims, drops empties and repeats, accepts Arabic commas", () => {
    expect(parseCommaList(" a, b ,, c,a ")).toEqual(["a", "b", "c"]);
    expect(parseCommaList("VLT-1، VLT-2")).toEqual(["VLT-1", "VLT-2"]);
    expect(parseCommaList("")).toEqual([]);
  });
  it("parseNumber", () => {
    expect(parseNumber("")).toBeNull();
    expect(parseNumber(" 12,5 ")).toBe(12.5);
    expect(parseNumber("abc")).toBeNaN();
  });
  it("parseParams", () => {
    expect(parseParams("")).toEqual({});
    expect(parseParams('{"a":1}')).toEqual({ a: 1 });
    expect(parseParams("[1]")).toBeNull();
    expect(parseParams("{bad")).toBeNull();
  });
  it("plainCheck strips the id prefix", () => {
    expect(plainCheck("led_5mm: port 1 sticks out", "led_5mm")).toBe("port 1 sticks out");
  });
});

describe("partToDraft / draftToPart", () => {
  it("round-trips every code part unchanged", () => {
    for (const p of LIBRARY) {
      const r = draftToPart(partToDraft(p));
      expect(r.ok, p.id).toBe(true);
      if (r.ok) expect(r.part).toEqual(p);
    }
  });

  it("reports field errors with codes", () => {
    const d = { ...emptyDraft(), id: "Bad Id", dimX: "abc", dimY: "-1", params: "{nope" };
    d.ports = [{ kind: "usb_c", face: "+q", u: "2", v: "0.5", w: "9", h: "3" }];
    d.pins = [
      { id: "a", label: "", role: "gpio", voltage: "", side: "" },
      { id: "a", label: "", role: "wizard", voltage: "x", side: "" },
    ];
    const r = draftToPart(d);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const has = (field: string, code: string) => r.errors.some((e) => e.field === field && e.code === code);
    expect(has("id", "id")).toBe(true);
    expect(has("nameEn", "required")).toBe(true);
    expect(has("dimX", "number")).toBe(true);
    expect(has("dimY", "positive")).toBe(true);
    expect(has("dimZ", "required")).toBe(true);
    expect(has("params", "json")).toBe(true);
    expect(has("ports.0.face", "choice")).toBe(true);
    expect(has("ports.0.u", "unit")).toBe(true);
    expect(has("pins.1.id", "duplicate_pin")).toBe(true);
    expect(has("pins.1.role", "choice")).toBe(true);
    expect(has("pins.1.voltage", "number")).toBe(true);
  });

  it("builds a valid STL part from a filled draft", () => {
    const d = {
      ...emptyDraft(),
      id: "my_board",
      nameEn: "My board",
      nameAr: "لوحتي",
      blurbEn: "A board.",
      blurbAr: "لوحة.",
      dimX: "40",
      dimY: "20",
      dimZ: "5",
      storeSkus: "VLT-1, VLT-2",
      tags: "Board, Test",
      modelKind: "stl" as const,
      stlUrl: "https://example.supabase.co/storage/v1/object/public/studio-models/my_board/1.stl",
    };
    const r = draftToPart(d);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.part.storeSkus).toEqual(["VLT-1", "VLT-2"]);
    expect(r.part.tags).toEqual(["board", "test"]);
    expect(r.part.mount).toBeNull();
    expect(checkLibraryPart(r.part).ok).toBe(true);
  });

  it("needs an https STL link", () => {
    const r = draftToPart({ ...partToDraft(LIBRARY[0]), modelKind: "stl", stlUrl: "ftp://x" });
    expect(r.ok).toBe(false);
  });
});
