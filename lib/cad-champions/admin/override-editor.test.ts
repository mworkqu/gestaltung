import { describe, expect, it } from "vitest";

import {
  buildMessageGroups,
  checkEntry,
  countOverridden,
  dirtyEntries,
  filterGroups,
  getReadyVideoSlots,
  isSafeMessageOverride,
  isValidVideoValue,
  leafAt,
  onlyChanged,
  placeholdersOf,
  planWrites,
} from "./override-editor";

const en = { welcome: { title: "Welcome", note: "Hello {name}, you have {count} steps.", rich: "Click <b>here</b>" }, steps: { a: { title: "One" } } };
const ar = { welcome: { title: "أهلًا", note: "مرحبًا {name}، لديك {count} خطوات.", rich: "اضغط <b>هنا</b>" }, steps: { a: { title: "واحد" } } };
const none = new Map<string, string>();

describe("buildMessageGroups", () => {
  it("groups by top-level key and pairs EN with AR defaults", () => {
    const g = buildMessageGroups("get-ready", en, ar, { en: new Map([["msg:get-ready.welcome.title", "Hi"]]), ar: none });
    expect(g.map((x) => x.id)).toEqual(["welcome", "steps"]);
    const t = g[0].items.find((i) => i.label === "welcome.title")!;
    expect(t).toMatchObject({ key: "msg:get-ready.welcome.title", defaultEn: "Welcome", defaultAr: "أهلًا", en: "Hi", ar: "" });
    expect(countOverridden(g[0])).toBe(1);
    expect(countOverridden(g[1])).toBe(0);
  });
});

describe("filterGroups", () => {
  const groups = buildMessageGroups("get-ready", en, ar, { en: none, ar: none });
  it("returns everything for an empty query", () => expect(filterGroups(groups, " ")).toHaveLength(2));
  it("matches defaults in either language", () => {
    expect(filterGroups(groups, "welcome")[0].id).toBe("welcome");
    expect(filterGroups(groups, "واحد")).toHaveLength(1);
    expect(filterGroups(groups, "واحد")[0].items).toHaveLength(1);
  });
  it("returns nothing when nothing matches", () => expect(filterGroups(groups, "zzz")).toEqual([]));
});

describe("dirtyEntries", () => {
  const items = [
    { key: "msg:a.b", kind: "text" as const },
    { key: "video:x", kind: "video" as const },
    { key: "faq:free.hidden", kind: "flag" as const },
  ];
  it("sends only changed items", () => {
    const base = { "msg:a.b": { en: "", ar: "" }, "video:x": { en: "", ar: "" }, "faq:free.hidden": { en: "", ar: "" } };
    expect(dirtyEntries(items, base, base)).toEqual([]);
    const cur = { ...base, "msg:a.b": { en: " Hi ", ar: "" }, "video:x": { en: "youtube:abcdefghijk", ar: "" }, "faq:free.hidden": { en: "1", ar: "" } };
    expect(dirtyEntries(items, cur, base)).toEqual([
      { key: "msg:a.b", en: "Hi", ar: "" },
      { key: "video:x", en: "youtube:abcdefghijk", ar: "youtube:abcdefghijk" },
      { key: "faq:free.hidden", en: "1", ar: "1" },
    ]);
  });
  it("clearing a saved value is a change (delete)", () => {
    const base = { "msg:a.b": { en: "Hi", ar: "" } };
    expect(dirtyEntries([items[0]], { "msg:a.b": { en: "", ar: "" } }, base)).toEqual([{ key: "msg:a.b", en: "", ar: "" }]);
  });
});

describe("message safety", () => {
  it("reads placeholders", () => expect(placeholdersOf("Hi {name}, {count, plural, one {# item} other {# items}}")).toEqual(["count", "name"]));
  it("accepts text that keeps placeholders and tags", () => {
    expect(isSafeMessageOverride(en.welcome.note, "Dear {count} {name}")).toBe(true);
    expect(isSafeMessageOverride(en.welcome.rich, "Press <b>this</b>")).toBe(true);
  });
  it("rejects dropped or added placeholders, tags and unbalanced braces", () => {
    expect(isSafeMessageOverride(en.welcome.note, "Hello {name}")).toBe(false);
    expect(isSafeMessageOverride("Plain", "Plain {x}")).toBe(false);
    expect(isSafeMessageOverride(en.welcome.rich, "Press here")).toBe(false);
    expect(isSafeMessageOverride("Plain", "Plain {")).toBe(false);
  });
});

describe("video values", () => {
  it("accepts YouTube ids and Bunny GUIDs only", () => {
    expect(isValidVideoValue("youtube:dQw4w9WgXcQ")).toBe(true);
    expect(isValidVideoValue("0f8fad5b-d9cb-469f-a165-70867728950e")).toBe(true);
    expect(isValidVideoValue("dQw4w9WgXcQ")).toBe(false);
    expect(isValidVideoValue("youtube:short")).toBe(false);
  });
  it("lists the Get Ready slots", () => {
    const keys = getReadyVideoSlots().map((s) => s.key);
    expect(keys).toContain("get_ready_welcome");
    expect(keys).toContain("install_inventor");
  });
});

describe("checkEntry", () => {
  const ctx = { messages: en };
  it("only allows existing string leaves", () => {
    expect(leafAt(en, "welcome.title")).toBe("Welcome");
    expect(leafAt(en, "welcome")).toBeNull();
    expect(checkEntry({ key: "msg:welcome.title", en: "Hi", ar: "" }, ctx)).toBeNull();
    expect(checkEntry({ key: "msg:welcome.nope", en: "Hi", ar: "" }, ctx)).toBe("unknown_message");
    expect(checkEntry({ key: "msg:welcome", en: "Hi", ar: "" }, ctx)).toBe("unknown_message");
    expect(checkEntry({ key: "msg:welcome.note", en: "{", ar: "" }, ctx)).toBe("unsafe_message");
  });
  it("rejects malformed and out-of-scope keys", () => {
    expect(checkEntry({ key: "nope", en: "", ar: "" }, ctx)).toBe("bad_key");
    expect(checkEntry({ key: "msg:welcome.title", en: "", ar: "" }, { ...ctx, allow: () => false })).toBe("out_of_scope");
  });
  it("checks videos, glossary and faq keys", () => {
    expect(checkEntry({ key: "video:get_ready_welcome", en: "youtube:dQw4w9WgXcQ", ar: "youtube:dQw4w9WgXcQ" }, ctx)).toBeNull();
    expect(checkEntry({ key: "video:get_ready_welcome", en: "bogus", ar: "" }, ctx)).toBe("bad_video");
    expect(checkEntry({ key: "video:nope", en: "", ar: "" }, ctx)).toBe("unknown_video");
    expect(checkEntry({ key: "glossary:step-file.term", en: "x", ar: "y" }, ctx)).toBeNull();
    expect(checkEntry({ key: "glossary:nope.term", en: "x", ar: "y" }, ctx)).toBe("unknown_glossary");
    expect(checkEntry({ key: "glossary:step-file.other", en: "x", ar: "y" }, ctx)).toBe("unknown_glossary");
    expect(checkEntry({ key: "faq:free.hidden", en: "1", ar: "1" }, ctx)).toBeNull();
    expect(checkEntry({ key: "faq:free.hidden", en: "2", ar: "" }, ctx)).toBe("bad_key");
    expect(checkEntry({ key: "faq:nope.hidden", en: "1", ar: "1" }, ctx)).toBe("unknown_faq");
  });
});

describe("planWrites / onlyChanged", () => {
  it("normalises, deletes empties and skips unchanged rows", () => {
    const w = planWrites([{ key: "msg:a.b", en: " Hi ", ar: "  " }]);
    expect(w).toEqual([
      { key: "msg:a.b", locale: "en", value: "Hi" },
      { key: "msg:a.b", locale: "ar", value: null },
    ]);
    expect(onlyChanged(w, new Map([["msg:a.b|en", "Hi"]]))).toEqual([]);
    expect(onlyChanged(w, new Map([["msg:a.b|ar", "old"]]))).toHaveLength(2);
  });
  it("last duplicate wins", () => {
    const w = planWrites([
      { key: "msg:a.b", en: "1", ar: "" },
      { key: "msg:a.b", en: "2", ar: "" },
    ]);
    expect(w.find((x) => x.locale === "en")?.value).toBe("2");
  });
});
