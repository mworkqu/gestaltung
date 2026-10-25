import { describe, expect, it } from "vitest";

import { newestUserText, replyLanguage } from "./reply-language";

describe("replyLanguage (F-047)", () => {
  it("mirrors Arabic written in the English studio", () => {
    expect(replyLanguage("اجعلها تعمل بالطاقة الشمسية", "en")).toBe("ar");
  });
  it("mirrors English written in the Arabic studio", () => {
    expect(replyLanguage("make it solar powered", "ar")).toBe("en");
  });
  it("keeps the page language for digits, emoji and ties", () => {
    expect(replyLanguage("4", "ar")).toBe("ar");
    expect(replyLanguage("👍", "en")).toBe("en");
    expect(replyLanguage("", "en")).toBe("en");
  });
  it("goes by the majority when a message mixes scripts", () => {
    expect(replyLanguage("أريد servo واحد فقط من فضلك", "en")).toBe("ar");
    expect(replyLanguage("add a pump مع خزان", "ar")).toBe("en");
  });
});

describe("newestUserText", () => {
  it("is the last user message, else the idea", () => {
    expect(newestUserText("idea", [{ role: "user", text: "a" }, { role: "assistant", text: "b" }, { role: "user", text: "c" }])).toBe("c");
    expect(newestUserText("idea", [])).toBe("idea");
  });
});

describe("the chat prompt mirrors the visitor's language for the reply only", () => {
  it("asks for an Arabic reply but English card text in the English studio", async () => {
    const { specPrompt } = await import("./prompts");
    const p = specPrompt({
      idea: "plant waterer",
      messages: [{ role: "user", text: "اجعلها تعمل بالطاقة الشمسية" }],
      locale: "en",
      replyLocale: "ar",
      forceSpec: false,
      current: { name: "x", oneLine: "y" } as never,
    });
    expect(p).toContain("names, understanding and features: English");
    expect(p).toContain("reply ONLY: Arabic");
  });
});

describe("runSpecChat reply language", () => {
  it("answers a greeting written in Arabic in Arabic even in the English studio", async () => {
    const { runSpecChat } = await import("./spec");
    const { fakeModel } = await import("./fake-model");
    const { GUARD_REPLY } = await import("./spec-guards");
    const m = fakeModel([]);
    const current = { name: "Plant buddy", oneLine: "x" } as never;
    const r = await runSpecChat({ call: m.call, idea: "plant", messages: [{ role: "user", text: "مرحبا" }], locale: "en", current });
    expect(r.ok && r.value.kind === "reply" && r.value.reply).toBe(GUARD_REPLY.greeting.ar);
  });
});
