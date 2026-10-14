import { describe, expect, it } from "vitest";

import { renderWeeklyProgressEmail } from "./weekly-email";

const base = {
  name: "Sara",
  lessonsDone: 2,
  exercisesPassed: 1,
  xp: 45,
  streak: 3,
  next: { title: "Holes and pockets", url: "https://gestaltung360.com/cad-champions/en/training/lessons/f2-holes-pockets" },
  trainingUrl: "https://gestaltung360.com/cad-champions/en/training",
  settingsUrl: "https://gestaltung360.com/cad-champions/en/account",
};

describe("weekly progress email", () => {
  it("says what was done and what is next, with an opt-out link", () => {
    const m = renderWeeklyProgressEmail({ ...base, locale: "en" });
    expect(m.subject).toBe("Your training this week");
    expect(m.text).toContain("finished 2 lessons and passed 1 exercise");
    expect(m.text).toContain("Holes and pockets");
    expect(m.text).toContain(base.settingsUrl);
    expect(m.html).toContain(base.next.url);
  });

  it("is Arabic and RTL for Arabic students, and handles a quiet week", () => {
    const m = renderWeeklyProgressEmail({ ...base, locale: "ar", lessonsDone: 0, exercisesPassed: 0, next: null });
    expect(m.html).toContain('dir="rtl"');
    expect(m.subject).toBe("تدريبك هذا الأسبوع");
    expect(m.text).toContain("لم تتدرب هذا الأسبوع");
    expect(m.html).toContain(base.trainingUrl);
  });
});
