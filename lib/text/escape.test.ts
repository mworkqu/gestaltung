import { describe, expect, it } from "vitest";

import { escapeHtml as emailEscapeHtml } from "@/lib/email";
import { escapeHtmlText } from "@/lib/email/brand-layout";
import { esc as netlistEsc } from "@/lib/prototyping/netlist";
import { escapeHtml, escapeXml, escapeXmlAttr } from "@/lib/text/escape";

const SAMPLES = [
  "",
  "plain",
  `<script>alert("x")</script>`,
  `Tom & Jerry's "show" > <b>`,
  "&amp; already escaped &lt;",
  "عربي <b> & 'quote'",
  "a\nb\tc",
];

describe("escapeHtml", () => {
  it("escapes the five characters", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });

  it("does not double-handle ampersands (single pass)", () => {
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });

  it("is byte-identical to the existing copies", () => {
    for (const s of SAMPLES) {
      expect(escapeHtml(s)).toBe(emailEscapeHtml(s));
      expect(escapeHtml(s)).toBe(escapeHtmlText(s));
    }
  });
});

describe("escapeXml", () => {
  it("matches escapeHtml on strings and coerces numbers like schematic.ts esc", () => {
    for (const s of SAMPLES) expect(escapeXml(s)).toBe(escapeHtml(s));
    expect(escapeXml(12.5)).toBe("12.5");
  });
});

describe("escapeXmlAttr", () => {
  it("is byte-identical to netlist.ts esc and leaves apostrophes alone", () => {
    for (const s of SAMPLES) expect(escapeXmlAttr(s)).toBe(netlistEsc(s));
    expect(escapeXmlAttr("it's")).toBe("it's");
    expect(escapeXmlAttr(`"a" & <b>`)).toBe("&quot;a&quot; &amp; &lt;b&gt;");
  });
});
