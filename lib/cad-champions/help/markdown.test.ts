import { describe, expect, it } from "vitest";

import { markdownToPlain, parseHelpMarkdown } from "./markdown";

describe("parseHelpMarkdown", () => {
  it("parses headings, paragraphs, ordered and bullet lists", () => {
    const blocks = parseHelpMarkdown("# Title\n\nHello **world**\n\n1. One\n2. Two\n\n- a\n- b");
    expect(blocks.map((b) => b.type)).toEqual(["heading", "paragraph", "list", "list"]);
    const ol = blocks[2];
    expect(ol.type === "list" && ol.ordered).toBe(true);
    const ul = blocks[3];
    expect(ul.type === "list" && ul.ordered).toBe(false);
  });

  it("parses images only for https or site-relative sources", () => {
    const blocks = parseHelpMarkdown("![ok](https://x.test/a.png)\n\n![local](/help/a.png)\n\n![bad](javascript:alert(1))");
    expect(blocks.filter((b) => b.type === "image")).toHaveLength(2);
  });

  it("parses a video slot, quote and table", () => {
    const blocks = parseHelpMarkdown("{{video}}\n\n> Tip: save first\n\n| A | B |\n| --- | --- |\n| 1 | 2 |");
    expect(blocks.map((b) => b.type)).toEqual(["video", "quote", "table"]);
  });

  it("strips markdown for plain text", () => {
    expect(markdownToPlain("# Hi\n\nSee [the guide](/help/x) and **bold** ![i](/a.png)")).toBe("Hi See the guide and bold");
  });
});
