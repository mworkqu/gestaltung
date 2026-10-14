// Every Get Ready / upload string the UI uses must exist in en AND ar.
// lib/cad-champions/messages.test.ts cannot see namespaces with a hyphen
// ("CC.get-ready"), so this test covers them: the keys content.ts builds,
// plus every literal t("…") in the get-ready, upload and video components.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { HELP_SEED_SLUGS } from "../help/seed-slugs";
import { GET_READY_STEP_KEYS } from "./steps";
import { HELP_SLUGS, STEP_HELP_SLUG, SOFTWARE_CONTENT, ESSENTIAL_ACTIONS, dynamicMessageKeys, tabForTrack } from "./content";

const ROOT = process.cwd();
type Tree = Record<string, unknown>;

function load(locale: string, file: string): Tree {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "messages", "cad-champions", locale, `${file}.json`), "utf8"));
}

function has(tree: Tree, dotted: string): boolean {
  let v: unknown = tree;
  for (const k of dotted.split(".")) v = v && typeof v === "object" ? (v as Tree)[k] : undefined;
  return typeof v === "string" && v.length > 0;
}

const files = { "get-ready": { en: load("en", "get-ready"), ar: load("ar", "get-ready") }, upload: { en: load("en", "upload"), ar: load("ar", "upload") } };

describe("get-ready content keys", () => {
  it("every dynamic key exists in en and ar", () => {
    const missing: string[] = [];
    for (const key of dynamicMessageKeys()) {
      for (const l of ["en", "ar"] as const) if (!has(files["get-ready"][l], key)) missing.push(`${l}: ${key}`);
    }
    expect(missing).toEqual([]);
  });

  it("every linked help slug is a seeded Help Center article", () => {
    const seeded = new Set<string>(HELP_SEED_SLUGS);
    const used = [
      ...Object.values(HELP_SLUGS),
      ...Object.values(STEP_HELP_SLUG),
      ...Object.values(SOFTWARE_CONTENT).map((c) => c.helpSlug),
      ...Object.values(ESSENTIAL_ACTIONS).map((c) => c.helpSlug),
    ];
    expect(used.filter((s) => !seeded.has(s))).toEqual([]);
    expect(Object.keys(STEP_HELP_SLUG).sort()).toEqual([...GET_READY_STEP_KEYS].sort());
  });

  it("opens the software tabs on the student's track, Inventor by default", () => {
    expect(tabForTrack(null)).toBe("inventor");
    expect(tabForTrack("fusion")).toBe("fusion");
    expect(tabForTrack("solidworks")).toBe("solidworks");
  });
});

function sourceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? sourceFiles(p) : /\.tsx?$/.test(e.name) ? [p] : [];
  });
}

describe("literal keys in components", () => {
  const dirs = ["get-ready", "upload", "video"].map((d) => path.join(ROOT, "components", "cad-champions", d));
  const sources = [...dirs.flatMap(sourceFiles), path.join(ROOT, "app", "[locale]", "cad-champions", "get-ready", "page.tsx")];

  it("finds the components", () => {
    expect(sources.length).toBeGreaterThan(3);
  });

  it("every literal t(\"key\") exists in en and ar", () => {
    const missing: string[] = [];
    for (const file of sources) {
      if (!fs.existsSync(file)) continue;
      const src = fs.readFileSync(file, "utf8");
      const decl = /(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*(?:\{[^}]*namespace:\s*)?["']CC\.(get-ready|upload)((?:\.[\w]+)*)["']/g;
      for (const d of src.matchAll(decl)) {
        const [, v, ns, sub] = d;
        const prefix = sub ? sub.slice(1) + "." : "";
        const use = new RegExp(`(?<![\\w.])${v}(?:\\.rich)?\\(\\s*"([\\w.]+)"`, "g");
        for (const u of src.matchAll(use)) {
          for (const l of ["en", "ar"] as const) {
            if (!has(files[ns as "get-ready" | "upload"][l], prefix + u[1])) missing.push(`${path.basename(file)} ${l}: ${ns}.${prefix}${u[1]}`);
          }
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
