import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { inlineText, parseInline, parseMarkdown, type Block } from "@/lib/legal/markdown";

describe("parseInline", () => {
  it("reads bold and plain text", () => {
    expect(parseInline("**1. Who we are.** Text")).toEqual([
      { type: "bold", children: [{ type: "text", value: "1. Who we are." }] },
      { type: "text", value: " Text" },
    ]);
  });

  it("keeps links to safe schemes and drops others", () => {
    expect(parseInline("[a](https://x.test)")[0]).toMatchObject({ type: "link", href: "https://x.test" });
    expect(parseInline("[bad](javascript:void0)")).toEqual([{ type: "text", value: "bad" }]);
  });

  it("never treats angle brackets as markup", () => {
    expect(parseInline("<script>x</script>")).toEqual([{ type: "text", value: "<script>x</script>" }]);
  });
});

describe("parseMarkdown", () => {
  it("separates paragraphs, lists (even without a blank line) and tables", () => {
    const blocks = parseMarkdown(
      "# H\n\n**13. Items.**\n- one\n- two\n\nlast\n\n| a | b |\n|---|---|\n| 1 | 2 |\n"
    );
    expect(blocks.map((b) => b.type)).toEqual(["heading", "paragraph", "list", "paragraph", "table"]);
    const list = blocks[2] as Extract<Block, { type: "list" }>;
    expect(list.items.map(inlineText)).toEqual(["one", "two"]);
    const table = blocks[4] as Extract<Block, { type: "table" }>;
    expect(table.head.map(inlineText)).toEqual(["a", "b"]);
    expect(table.rows[0].map(inlineText)).toEqual(["1", "2"]);
  });
});

// The eight content files render without losing a single word of the source.
describe("content/legal files", () => {
  const slugs = ["delivery-returns", "warranty", "terms", "privacy"];
  for (const slug of slugs) {
    for (const lang of ["en", "ar"]) {
      it(`${slug}.${lang}.md keeps every character of text`, () => {
        const src = readFileSync(join(process.cwd(), "content", "legal", `${slug}.${lang}.md`), "utf8");
        const blocks = parseMarkdown(src);
        const text = blocks
          .flatMap((b) => (b.type === "list" ? b.items : b.type === "table" ? [] : [b.children]))
          .map(inlineText)
          .join("");
        // Markup characters and whitespace aside, the text is identical.
        const strip = (s: string) => s.replace(/\*\*/g, "").replace(/^\s*-\s+/gm, "").replace(/\s+/g, "");
        expect(strip(text)).toBe(strip(src));
        expect(src).toMatch(/Last updated|آخر تحديث/);
      });
    }
  }
});
