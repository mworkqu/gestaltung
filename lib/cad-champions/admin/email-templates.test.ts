import { describe, expect, it } from "vitest";

import { AUTH_TEMPLATE_FILES, findEmailTemplate, listEmailTemplates } from "./email-templates";

const ARABIC = /[؀-ۿ]/;

describe("email template registry", () => {
  const defs = listEmailTemplates();

  it("has unique ids and covers payments, questions, results, weekly and announcements", () => {
    const ids = defs.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ["payment_reserved", "payment_approved", "payment_reminder_1d", "answer_lesson", "results_final", "weekly_progress", "announcement"]) {
      expect(ids).toContain(id);
    }
    expect(AUTH_TEMPLATE_FILES).toHaveLength(3);
  });

  for (const def of listEmailTemplates()) {
    for (const locale of ["en", "ar"] as const) {
      it(`${def.id} renders non-empty html, text and subject (${locale})`, () => {
        const mail = def.render(locale, "https://example.test");
        expect(mail.subject.trim().length).toBeGreaterThan(3);
        expect(mail.html).toContain("<html");
        expect(mail.html.length).toBeGreaterThan(500);
        expect(mail.text.trim().length).toBeGreaterThan(40);
        expect(mail.html).not.toContain("undefined");
        expect(mail.text).not.toContain("undefined");
        expect(mail.html).not.toContain("[object Object]");
      });
    }
    if (def.bilingual) {
      it(`${def.id} carries both Arabic and English (bilingual)`, () => {
        const mail = def.render("en", "https://example.test");
        expect(ARABIC.test(mail.html)).toBe(true);
        expect(/[A-Za-z]{4,}/.test(mail.text.replace(/https?:\/\/\S+/g, ""))).toBe(true);
      });
    }
  }

  it("renders the single-language weekly email in the chosen language", () => {
    const def = findEmailTemplate("weekly_progress")!;
    expect(ARABIC.test(def.render("ar", "https://example.test").html)).toBe(true);
    expect(def.render("en", "https://example.test").subject).toBe("Your training this week");
  });

  it("puts the student's language first for locale-aware emails", () => {
    const def = findEmailTemplate("payment_approved")!;
    const en = def.render("en", "https://example.test");
    const ar = def.render("ar", "https://example.test");
    expect(en.subject).not.toBe(ar.subject);
    expect(en.subject.startsWith("Payment confirmed")).toBe(true);
    expect(ARABIC.test(ar.subject.slice(0, 6))).toBe(true);
  });

  it("finds a template by id and rejects an unknown id", () => {
    expect(findEmailTemplate("announcement")?.group).toBe("announcements");
    expect(findEmailTemplate("nope")).toBeNull();
  });
});
