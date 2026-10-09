import { describe, expect, it } from "vitest";

import {
  buildCaseStudies,
  getCaseStudy,
  listCaseStudies,
  localizedCaseStudy,
  parseCaseStudy,
  parseFrontmatter,
  sortCaseStudies,
  splitBodies,
} from "@/lib/case-studies";
import { inlineText, type Block } from "@/lib/legal/markdown";

/** Plain text of the first paragraph. */
function firstText(blocks: Block[]): string {
  const b = blocks[0];
  return b && b.type === "paragraph" ? inlineText(b.children) : "";
}

function file(over: Record<string, string | string[]> = {}, body = "English text.\n\n<!-- ar -->\n\nنص عربي."): string {
  const base: Record<string, string | string[]> = {
    slug: "demo",
    sector: "startup",
    title_en: "Title",
    title_ar: "عنوان",
    persona: "Founder",
    summary_en: "Summary",
    summary_ar: "ملخص",
    ...over,
  };
  const lines = Object.entries(base)
    .filter(([, v]) => v !== "")
    .flatMap(([k, v]) => (Array.isArray(v) ? [`${k}:`, ...v.map((x) => `  - ${x}`)] : [`${k}: ${v}`]));
  return `---\n${lines.join("\n")}\n---\n${body}\n`;
}

describe("parseFrontmatter", () => {
  it("reads scalars, quotes and lists", () => {
    const fm = parseFrontmatter('---\na: one\nb: "two: 2"\nc: \'it\'\'s\'\nlist:\n  - x\n  - "y"\n---\nbody\n');
    expect(fm?.data).toEqual({ a: "one", b: "two: 2", c: "it's", list: ["x", "y"] });
    expect(fm?.body).toBe("body\n");
  });

  it("accepts CRLF, a BOM and a leading comment", () => {
    const fm = parseFrontmatter("﻿<!-- note -->\r\n---\r\na: 1\r\n---\r\nhello");
    expect(fm?.data).toEqual({ a: "1" });
    expect(fm?.body).toBe("hello");
  });

  it("returns null without a frontmatter block or with a malformed line", () => {
    expect(parseFrontmatter("no frontmatter")).toBeNull();
    expect(parseFrontmatter("---\nnot a key value line\n---\nx")).toBeNull();
    expect(parseFrontmatter("---\n  - orphan item\n---\nx")).toBeNull();
  });
});

describe("splitBodies", () => {
  it("splits on the ar marker and drops other comments", () => {
    const { en, ar } = splitBodies("A <!-- hidden --> B\n\n<!-- ar -->\n\nC");
    expect(en).toBe("A  B");
    expect(ar).toBe("C");
  });

  it("gives an empty Arabic body when there is no marker", () => {
    expect(splitBodies("Only English")).toEqual({ en: "Only English", ar: "" });
  });
});

describe("parseCaseStudy", () => {
  it("parses a valid file, defaulting published to false", () => {
    const cs = parseCaseStudy("demo.md", file());
    expect(cs).not.toBeNull();
    expect(cs!.published).toBe(false);
    expect(cs!.sector).toBe("startup");
    expect(cs!.persona_ar).toBe("Founder");
    expect(cs!.date).toBeNull();
    expect(firstText(cs!.body_en)).toBe("English text.");
    expect(firstText(cs!.body_ar)).toBe("نص عربي.");
  });

  it("reads published, date, persona_ar and outcome lists", () => {
    const cs = parseCaseStudy(
      "demo.md",
      file({ published: "true", date: "2026-03-01", persona_ar: "مؤسس", outcome_en: ["a", "b"], outcome_ar: ["أ"] }),
    )!;
    expect(cs.published).toBe(true);
    expect(cs.date).toBe("2026-03-01");
    expect(cs.persona_ar).toBe("مؤسس");
    expect(cs.outcome_en).toEqual(["a", "b"]);
    expect(cs.outcome_ar).toEqual(["أ"]);
  });

  it("drops invalid files", () => {
    expect(parseCaseStudy("demo.md", file({ sector: "factory" }))).toBeNull();
    expect(parseCaseStudy("demo.md", file({ title_en: "" }))).toBeNull();
    expect(parseCaseStudy("demo.md", file({ title_ar: "" }))).toBeNull();
    expect(parseCaseStudy("demo.md", file({ summary_en: "" }))).toBeNull();
    expect(parseCaseStudy("other.md", file())).toBeNull(); // slug differs from the file name
    expect(parseCaseStudy("Demo Story.md", file({ slug: "Demo Story" }))).toBeNull(); // bad slug
    expect(parseCaseStudy("demo.md", file({ published: "yes" }))).toBeNull();
    expect(parseCaseStudy("demo.md", file({ date: "2026-02-30" }))).toBeNull();
    expect(parseCaseStudy("demo.md", file({ date: "soon" }))).toBeNull();
    expect(parseCaseStudy("demo.md", "just text")).toBeNull();
  });

  it("never treats text as markup", () => {
    const cs = parseCaseStudy("demo.md", file({}, "<script>x</script> [bad](javascript:alert(1))"))!;
    const text = firstText(cs.body_en);
    expect(text).toContain("<script>");
    expect(text).toContain("bad");
    expect(JSON.stringify(cs.body_en)).not.toContain("javascript:");
  });
});

describe("sorting and building", () => {
  it("sorts by date desc (undated last) then slug", () => {
    const items = [
      { slug: "b", date: null },
      { slug: "a", date: "2026-01-01" },
      { slug: "c", date: "2026-05-01" },
      { slug: "a2", date: "2026-01-01" },
      { slug: "a0", date: null },
    ];
    expect(sortCaseStudies(items).map((i) => i.slug)).toEqual(["c", "a", "a2", "a0", "b"]);
  });

  it("drops invalid files and duplicate slugs", () => {
    const list = buildCaseStudies([
      { name: "z-story.md", content: file({ slug: "z-story", date: "2026-01-01" }) },
      { name: "a-story.md", content: file({ slug: "a-story", date: "2026-06-01" }) },
      { name: "bad.md", content: file({ slug: "bad", sector: "x" }) },
      { name: "mismatch.md", content: file({ slug: "other" }) },
      { name: "z-story.md", content: file({ slug: "z-story" }) },
    ]);
    expect(list.map((c) => c.slug)).toEqual(["a-story", "z-story"]);
  });

  it("picks the localised fields", () => {
    const cs = parseCaseStudy("demo.md", file({ persona_ar: "مؤسس" }))!;
    expect(localizedCaseStudy(cs, "en")).toMatchObject({ title: "Title", persona: "Founder", summary: "Summary" });
    expect(localizedCaseStudy(cs, "ar")).toMatchObject({ title: "عنوان", persona: "مؤسس", summary: "ملخص" });
  });
});

// The one file we ship is an unpublished template, in both languages.
describe("content/case-studies/example-startup.md", () => {
  const cs = getCaseStudy("example-startup");

  it("is valid but unpublished, so no public list shows it", () => {
    expect(cs).not.toBeNull();
    expect(cs!.published).toBe(false);
    expect(listCaseStudies({ publishedOnly: true }).map((c) => c.slug)).not.toContain("example-startup");
    expect(listCaseStudies().map((c) => c.slug)).toContain("example-startup");
  });

  it("says EXAMPLE in English and Arabic and carries Arabic body text", () => {
    expect(cs!.title_en).toMatch(/^EXAMPLE/);
    expect(cs!.summary_en).toMatch(/EXAMPLE/);
    expect(cs!.title_ar).toMatch(/مثال/);
    expect(cs!.summary_ar).toMatch(/مثال/);
    expect(cs!.body_en.length).toBeGreaterThan(0);
    expect(cs!.body_ar.length).toBeGreaterThan(0);
  });

  it("returns null for an unknown slug", () => {
    expect(getCaseStudy("does-not-exist")).toBeNull();
  });
});
