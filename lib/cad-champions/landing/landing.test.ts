import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { CC_FAQ, CC_FAQ_IDS, isCcFaqId, visibleFaq } from "./faq";
import { centreDistance, gearDims, gearOutline, HERO_GEARS, meshPhase, outlineToPath } from "./gear";
import { heroMode } from "./hero-mode";
import { buildLandingJsonLd, serializeJsonLd } from "./json-ld";
import {
  FALLBACK_MODULES,
  FALLBACK_SKILL_AREAS,
  normaliseModules,
  normaliseSkillAreas,
  totalHours,
} from "./seed";

const LANDING = (locale: string) =>
  JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "messages", "cad-champions", locale, "landing.json"), "utf8"),
  ) as Record<string, unknown>;

function at(tree: unknown, dotted: string): unknown {
  return dotted.split(".").reduce<unknown>((v, k) => (v && typeof v === "object" ? (v as Record<string, unknown>)[k] : undefined), tree);
}

describe("landing FAQ", () => {
  it("has the 12 plan questions plus eligibility and competition software", () => {
    expect(CC_FAQ_IDS).toHaveLength(14);
    expect(CC_FAQ_IDS).toContain("eligibility");
    expect(CC_FAQ_IDS).toContain("competitionSoftware");
    expect(new Set(CC_FAQ_IDS).size).toBe(14);
  });

  it("every question and answer exists in both locales", () => {
    for (const locale of ["en", "ar"]) {
      const msgs = LANDING(locale);
      for (const item of CC_FAQ) {
        expect(typeof at(msgs, item.questionKey), `${locale} ${item.questionKey}`).toBe("string");
        expect(typeof at(msgs, item.answerKey), `${locale} ${item.answerKey}`).toBe("string");
      }
    }
  });

  it("filters hidden items and recognises ids", () => {
    expect(visibleFaq([{ ...CC_FAQ[0], hidden: true }, CC_FAQ[1]])).toEqual([CC_FAQ[1]]);
    expect(isCcFaqId("free")).toBe(true);
    expect(isCcFaqId("nope")).toBe(false);
  });

  it("never names WorldSkills in a title-like string", () => {
    for (const locale of ["en", "ar"]) {
      const msgs = LANDING(locale);
      expect(String(at(msgs, "meta.title"))).not.toMatch(/worldskills/i);
      expect(String(at(msgs, "hero.title"))).not.toMatch(/worldskills/i);
    }
  });
});

describe("landing seed data", () => {
  it("fallback weights add up to 100 and hours to 22", () => {
    expect(FALLBACK_SKILL_AREAS.reduce((s, a) => s + a.weight_percent, 0)).toBe(100);
    expect(totalHours(FALLBACK_MODULES)).toBe(22);
  });

  it("uses DB rows when complete and falls back otherwise", () => {
    const rows = FALLBACK_SKILL_AREAS.map((a) => ({ ...a, weight_percent: String(a.weight_percent) })).reverse();
    expect(normaliseSkillAreas(rows).map((a) => a.id)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(normaliseSkillAreas(rows.slice(1))).toBe(FALLBACK_SKILL_AREAS);
    expect(normaliseSkillAreas(null)).toBe(FALLBACK_SKILL_AREAS);
    expect(normaliseSkillAreas([...rows, rows[0]])).toBe(FALLBACK_SKILL_AREAS);
  });

  it("keeps active modules in position order, hours as numbers", () => {
    const rows = [
      { ...FALLBACK_MODULES[3], hours: "4.0", is_active: true },
      { ...FALLBACK_MODULES[0], hours: "6.0", is_active: true },
      { ...FALLBACK_MODULES[1], is_active: false },
    ];
    const out = normaliseModules(rows);
    expect(out.map((m) => m.code)).toEqual(["M1", "M4"]);
    expect(out[1].hours).toBe(4);
    expect(normaliseModules([])).toBe(FALLBACK_MODULES);
    expect(normaliseModules({})).toBe(FALLBACK_MODULES);
  });
});

describe("hero mode", () => {
  const ok = { reducedMotion: false, webgl: true };
  it("loads 3D only on capable devices without data saving", () => {
    expect(heroMode(ok)).toBe("3d");
    expect(heroMode({ ...ok, deviceMemory: 8, cores: 8, effectiveType: "4g" })).toBe("3d");
    expect(heroMode({ ...ok, reducedMotion: true })).toBe("static");
    expect(heroMode({ ...ok, webgl: false })).toBe("static");
    expect(heroMode({ ...ok, saveData: true })).toBe("static");
    expect(heroMode({ ...ok, effectiveType: "2g" })).toBe("static");
    expect(heroMode({ ...ok, deviceMemory: 2 })).toBe("static");
    expect(heroMode({ ...ok, cores: 2 })).toBe("static");
  });
});

describe("hero gears", () => {
  it("builds 4 points per tooth within the outer radius", () => {
    const g = HERO_GEARS.driver;
    const pts = gearOutline(g);
    expect(pts).toHaveLength(g.teeth * 4);
    const { outer, root } = gearDims(g);
    for (const [x, y] of pts) {
      const r = Math.hypot(x, y);
      expect(r).toBeLessThanOrEqual(outer + 1e-3);
      expect(r).toBeGreaterThanOrEqual(root - 1e-3);
    }
  });

  it("meshes: centre distance is the sum of pitch radii, driven tooth gap faces the driver", () => {
    const { driver, driven } = HERO_GEARS;
    expect(centreDistance(driver, driven)).toBeCloseTo(gearDims(driver).pitch + gearDims(driven).pitch);
    const phase = meshPhase(driven);
    const step = (2 * Math.PI) / driven.teeth;
    // No driven tooth is centred exactly at angle pi (facing the driver).
    for (let k = 0; k < driven.teeth; k++) {
      const a = (((k * step + phase) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      expect(Math.abs(a - Math.PI)).toBeGreaterThan(step / 4);
    }
  });

  it("writes a closed SVG path", () => {
    const d = outlineToPath([[0, 0], [1, 0], [1, 1]], 10, 10);
    expect(d).toBe("M10 10L11 10L11 11Z");
    expect(outlineToPath([])).toBe("");
  });
});

describe("landing JSON-LD", () => {
  const input = {
    locale: "en" as const,
    url: "https://gestaltung360.com/cad-champions/en",
    siteUrl: "https://gestaltung360.com",
    name: "CAD Champions",
    description: "Training",
    orgName: "Gestaltung360",
    orgDescription: "Studio",
    addressLocality: "Lusail",
    addressCountry: "QA",
    faq: [
      { question: "Is it free?", answer: "Yes." },
      { question: " ", answer: "dropped" },
    ],
  };

  it("emits a Course with an EducationalOrganization provider and a FAQPage", () => {
    const [course, faq] = buildLandingJsonLd(input);
    expect(course["@type"]).toBe("Course");
    expect((course.provider as Record<string, unknown>)["@type"]).toBe("EducationalOrganization");
    expect(faq["@type"]).toBe("FAQPage");
    expect(faq.mainEntity).toHaveLength(1);
  });

  it("escapes characters that could close the script tag", () => {
    const s = serializeJsonLd({ a: "</script><b>&" });
    expect(s).not.toContain("</script>");
    expect(s).not.toContain("<");
    expect(JSON.parse(s)).toEqual({ a: "</script><b>&" });
  });
});
