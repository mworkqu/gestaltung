import { describe, expect, it } from "vitest";

import { buildNamePrompt, cleanProjectName, generateProjectName, MAX_PROJECT_NAME } from "@/lib/projects/name-from-brief";

const BRIEF = "A box that waters my balcony plants when the soil is dry.";

describe("generateProjectName", () => {
  it("returns a good name as is", async () => {
    const name = await generateProjectName({ brief: BRIEF, locale: "en", call: async () => ({ name: "Balcony plant waterer" }) });
    expect(name).toBe("Balcony plant waterer");
  });

  it("cleans a quoted, punctuated name", async () => {
    const name = await generateProjectName({
      brief: BRIEF,
      locale: "en",
      call: async () => ({ name: '  "Smart   Plant Waterer."  ' }),
    });
    expect(name).toBe("Smart Plant Waterer");
  });

  it("truncates an over-long name to 60 characters on a word", async () => {
    const long = "Automatic balcony plant watering system with soil moisture sensing and solar power";
    const name = await generateProjectName({ brief: BRIEF, locale: "en", call: async () => ({ name: long }) });
    expect(name).not.toBeNull();
    expect(name!.length).toBeLessThanOrEqual(MAX_PROJECT_NAME);
    expect(long.startsWith(name!)).toBe(true);
    expect(name!.endsWith(" ")).toBe(false);
  });

  it("returns null when the call throws", async () => {
    const name = await generateProjectName({
      brief: BRIEF,
      locale: "en",
      call: async () => {
        throw new Error("503");
      },
    });
    expect(name).toBeNull();
  });

  it("returns null for an empty brief without calling", async () => {
    let called = false;
    const call = async () => {
      called = true;
      return { name: "x y z" };
    };
    expect(await generateProjectName({ brief: "   ", locale: "en", call })).toBeNull();
    expect(await generateProjectName({ brief: null, locale: "en", call })).toBeNull();
    expect(called).toBe(false);
  });

  it("asks in the page language", () => {
    expect(buildNamePrompt(BRIEF, "ar").system).toContain("Arabic");
    expect(buildNamePrompt(BRIEF, "en").prompt).toContain(BRIEF);
  });
});

describe("cleanProjectName", () => {
  it("rejects empty and placeholder names", () => {
    expect(cleanProjectName("", "fallback")).toBe("fallback");
    expect(cleanProjectName('"..."', null)).toBeNull();
    expect(cleanProjectName("New project", null)).toBeNull();
    expect(cleanProjectName("مشروع جديد", null)).toBeNull();
    expect(cleanProjectName(42, "fallback")).toBe("fallback");
  });

  it("strips Arabic punctuation and guillemets", () => {
    expect(cleanProjectName("«ساعة غوص ذكية»؟", null)).toBe("ساعة غوص ذكية");
  });

  it("keeps inner hyphens", () => {
    expect(cleanProjectName("Wi-Fi door sensor!", null)).toBe("Wi-Fi door sensor");
  });
});
