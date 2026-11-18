import { describe, expect, it } from "vitest";

import {
  applyMessageOverrides,
  clientOverrides,
  flattenMessages,
  getOverride,
  isOverrideKey,
  msgKey,
  normaliseOverrideValue,
  toOverrideMap,
} from "./overrides";

const CC = {
  "get-ready": { welcome: { autoNote: "Watch it", title: "Welcome" }, steps: { a: "A" } },
  landing: { faq: { items: { free: { q: "Is it free?", a: "Yes" } } } },
};

describe("content overrides", () => {
  it("validates keys", () => {
    expect(isOverrideKey("msg:get-ready.welcome.autoNote")).toBe(true);
    expect(isOverrideKey("video:get_ready_welcome")).toBe(true);
    expect(isOverrideKey("glossary:step-file.definition")).toBe(true);
    expect(isOverrideKey("faq:free.hidden")).toBe(true);
    expect(isOverrideKey("other:x")).toBe(false);
    expect(isOverrideKey("msg:a b")).toBe(false);
    expect(isOverrideKey(42)).toBe(false);
  });

  it("builds a per-locale map ignoring blanks and bad keys", () => {
    const map = toOverrideMap(
      [
        { key: "msg:landing.faq.items.free.q", locale: "en", value: "Free?" },
        { key: "msg:landing.faq.items.free.q", locale: "ar", value: "مجاني؟" },
        { key: "msg:landing.faq.items.free.a", locale: "en", value: "   " },
        { key: "bad key", locale: "en", value: "x" },
      ],
      "en",
    );
    expect([...map.entries()]).toEqual([["msg:landing.faq.items.free.q", "Free?"]]);
    expect(getOverride(map, "msg:landing.faq.items.free.q", "fallback")).toBe("Free?");
    expect(getOverride(map, "msg:landing.faq.items.free.a", "fallback")).toBe("fallback");
    expect(getOverride(null, "x", "fb")).toBe("fb");
  });

  it("replaces existing string leaves only, without mutating the input", () => {
    const map = new Map([
      [msgKey("get-ready.welcome.autoNote"), "Edited"],
      [msgKey("get-ready.welcome"), "branch!"],
      [msgKey("get-ready.welcome.missing"), "new"],
      [msgKey("get-ready.__proto__.x"), "evil"],
      ["video:get_ready_welcome", "youtube:abcdefghijk"],
    ]);
    const out = applyMessageOverrides(CC, map);
    expect(out["get-ready"].welcome.autoNote).toBe("Edited");
    expect(out["get-ready"].welcome.title).toBe("Welcome");
    expect((out["get-ready"].welcome as Record<string, unknown>).missing).toBeUndefined();
    expect(typeof out["get-ready"].welcome).toBe("object");
    expect(CC["get-ready"].welcome.autoNote).toBe("Watch it");
    expect(out.landing).toBe(CC.landing);
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });

  it("returns the same tree when nothing applies", () => {
    expect(applyMessageOverrides(CC, new Map())).toBe(CC);
    expect(applyMessageOverrides(CC, null)).toBe(CC);
  });

  it("flattens a message tree", () => {
    expect(flattenMessages(CC.landing)).toEqual([
      ["faq.items.free.q", "Is it free?"],
      ["faq.items.free.a", "Yes"],
    ]);
  });

  it("splits video and glossary overrides for the client", () => {
    const co = clientOverrides(
      new Map([
        ["video:get_ready_welcome", "youtube:abcdefghijk"],
        ["glossary:step-file.definition", "A STEP file…"],
        ["glossary:step-file.term", "STEP"],
        ["glossary:x.other", "ignored"],
        ["msg:landing.x", "ignored"],
      ]),
    );
    expect(co.videos).toEqual({ get_ready_welcome: "youtube:abcdefghijk" });
    expect(co.glossary).toEqual({ "step-file": { definition: "A STEP file…", term: "STEP" } });
  });

  it("normalises saved values", () => {
    expect(normaliseOverrideValue("  hi\r\nthere ")).toBe("hi\nthere");
    expect(normaliseOverrideValue("   ")).toBeNull();
    expect(normaliseOverrideValue(5)).toBeNull();
    expect(normaliseOverrideValue("abcdef", 3)).toBe("abc");
  });
});
