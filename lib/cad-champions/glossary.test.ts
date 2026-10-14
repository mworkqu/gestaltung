import { describe, expect, it } from "vitest";
import { GLOSSARY, GLOSSARY_IDS, getGlossaryEntry } from "./glossary";

describe("glossary", () => {
  it("has 31 entries", () => {
    expect(GLOSSARY_IDS).toHaveLength(31);
  });

  it("every entry has non-empty en and ar term and definition", () => {
    for (const id of GLOSSARY_IDS) {
      const e = GLOSSARY[id];
      for (const loc of ["en", "ar"] as const) {
        expect(e[loc].term.trim().length, `${id}.${loc}.term`).toBeGreaterThan(0);
        expect(e[loc].definition.trim().length, `${id}.${loc}.definition`).toBeGreaterThan(0);
      }
    }
  });

  it("Arabic definitions contain Arabic script and Western digits only", () => {
    for (const id of GLOSSARY_IDS) {
      expect(GLOSSARY[id].ar.definition, id).toMatch(/[؀-ۿ]/);
      expect(GLOSSARY[id].ar.definition, id).not.toMatch(/[٠-٩]/);
    }
  });

  it("getGlossaryEntry returns the right locale and helpSlug", () => {
    expect(getGlossaryEntry("step-file", "en").term).toBe("STEP file");
    expect(getGlossaryEntry("step-file", "ar").term).toContain("STEP");
    expect(getGlossaryEntry("step-file", "en").helpSlug).toBe("how-to-export-step");
    expect(getGlossaryEntry("volume", "en").helpSlug).toBeUndefined();
  });

  it("projection definitions are technically right", () => {
    expect(GLOSSARY["first-angle-projection"].en.definition).toMatch(/below the front view/);
    expect(GLOSSARY["third-angle-projection"].en.definition).toMatch(/above the front view/);
  });
});
