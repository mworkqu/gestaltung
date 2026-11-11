import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseHelpMarkdown } from "../help/markdown";
import { prepPolicyMarkdown } from "./prep";

describe("prepPolicyMarkdown", () => {
  it("drops the DRAFT comment and fills the contact email", () => {
    const out = prepPolicyMarkdown("<!-- DRAFT -->\n# Title\n\nMail {{contact_email}}.", "a@b.co");
    expect(out.startsWith("# Title")).toBe(true);
    expect(out).toContain("Mail a@b.co.");
  });
});

describe("policy files", () => {
  const ids = ["privacy", "terms", "refunds"];
  for (const id of ids) {
    for (const lang of ["en", "ar"]) {
      it(`${id}.${lang}.md exists, starts with a DRAFT marker and parses`, () => {
        const raw = fs.readFileSync(path.join(process.cwd(), "content/cad-champions", `${id}.${lang}.md`), "utf8");
        expect(raw.trimStart().startsWith("<!--")).toBe(true);
        expect(raw.split("\n")[0]).toContain("DRAFT");
        expect(parseHelpMarkdown(prepPolicyMarkdown(raw, "x@y.z")).length).toBeGreaterThan(5);
        expect(/[٠-٩]/.test(raw)).toBe(false); // Western digits only
      });
    }
  }
});
