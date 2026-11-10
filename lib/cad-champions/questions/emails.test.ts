import { describe, expect, it } from "vitest";

import { renderAnswerEmail } from "./emails";

describe("answer email", () => {
  it("is bilingual, student's language first, one button to the page", () => {
    const m = renderAnswerEmail({
      locale: "ar",
      name: "سارة",
      kind: "grade_query",
      question: "Why did I lose the projection item?",
      answer: "Your symbol shows first angle but the views are third angle.",
      url: "https://gestaltung360.com/cad-champions/ar/results/abc",
    });
    expect(m.subject).toBe("أجاب المدرّب عن سؤالك · A trainer answered your question");
    expect(m.html).toContain('href="https://gestaltung360.com/cad-champions/ar/results/abc"');
    expect(m.html).toContain("Your symbol shows first angle");
    expect(m.text).toContain("A trainer has answered your question about your result.");
    expect(m.html.indexOf("مرحبًا سارة")).toBeLessThan(m.html.indexOf("Hi سارة"));
  });

  it("escapes the student's text", () => {
    const m = renderAnswerEmail({ locale: "en", name: null, kind: "lesson", question: "<script>x</script>", answer: "a & b", url: "https://x.test/" });
    expect(m.html).not.toContain("<script>x");
    expect(m.html).toContain("a &amp; b");
  });
});
