import { describe, expect, it } from "vitest";

import {
  BATCH_SIZE,
  batchCount,
  chunk,
  deliveryKey,
  nextStatus,
  renderAnnouncementEmail,
  renderBody,
  selectRecipients,
  validateAnnouncement,
  type AnnouncementDraft,
} from "./announcements";
import { EMPTY_STUDENT_FILTERS, type StudentRow } from "./students";

const NOW = Date.parse("2026-10-14T00:00:00Z");

function student(over: Partial<StudentRow> & { id: string }): StudentRow {
  return {
    name: "Sara",
    nameAr: null,
    email: `${over.id}@example.com`,
    phone: null,
    institution: "Qatar University",
    studyLevel: "bachelor",
    isMinor: false,
    marketingConsent: true,
    preferredLocale: "en",
    getReadyPercent: 100,
    getReadyDoneAt: null,
    getReadyBypass: false,
    latestPercent: null,
    latestBand: null,
    latestAttemptAt: null,
    enrolledUntil: null,
    lastActiveAt: null,
    createdAt: "2026-09-01T00:00:00Z",
    openFlags: 0,
    deletionRequested: false,
    ...over,
  };
}

const DRAFT: AnnouncementDraft = {
  kind: "marketing",
  subjectEn: "New cohort <open>",
  subjectAr: "دفعة جديدة",
  bodyEn: "Hello **there**\n\n- one\n- two\n\nSee [the page](https://example.com/a?x=1&y=2).",
  bodyAr: "مرحبًا بك\n\n- الأول\n- الثاني",
};

describe("validateAnnouncement", () => {
  it("accepts a complete bilingual draft and trims", () => {
    const r = validateAnnouncement({ ...DRAFT, subjectEn: "  Hi  " });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.subjectEn).toBe("Hi");
  });
  it("reports every missing field and the kind", () => {
    const r = validateAnnouncement({ kind: "bogus", subjectEn: "", subjectAr: " ", bodyEn: "", bodyAr: "" });
    expect(r).toEqual({ ok: false, errors: ["kind", "subject_en_required", "subject_ar_required", "body_en_required", "body_ar_required"] });
  });
  it("limits lengths", () => {
    const r = validateAnnouncement({ ...DRAFT, subjectEn: "x".repeat(151), bodyAr: "y".repeat(5001) });
    expect(r).toEqual({ ok: false, errors: ["subject_too_long", "body_too_long"] });
  });
});

describe("selectRecipients", () => {
  const rows = [
    student({ id: "a" }),
    student({ id: "b", marketingConsent: false }),
    student({ id: "c", email: null }),
    student({ id: "d", deletionRequested: true }),
    student({ id: "e", email: "not-an-email" }),
    student({ id: "f", institution: "HBKU" }),
  ];
  it("marketing respects marketing_consent and skips deletion / no email", () => {
    const r = selectRecipients(rows, EMPTY_STUDENT_FILTERS, "marketing", NOW);
    expect(r.recipients.map((x) => x.id)).toEqual(["a", "f"]);
    expect(r.skipped).toEqual({ noEmail: 2, deletionRequested: 1, noConsent: 1 });
  });
  it("essential ignores marketing_consent but still skips deletion / no email", () => {
    const r = selectRecipients(rows, EMPTY_STUDENT_FILTERS, "essential", NOW);
    expect(r.recipients.map((x) => x.id)).toEqual(["a", "b", "f"]);
    expect(r.skipped.noConsent).toBe(0);
  });
  it("uses the Students filters", () => {
    const r = selectRecipients(rows, { ...EMPTY_STUDENT_FILTERS, institution: "HBKU" }, "marketing", NOW);
    expect(r.recipients.map((x) => x.id)).toEqual(["f"]);
    expect(r.skipped).toEqual({ noEmail: 0, deletionRequested: 0, noConsent: 0 });
  });
});

describe("batches and status", () => {
  it("plans batches", () => {
    expect(batchCount(0)).toBe(0);
    expect(batchCount(1)).toBe(1);
    expect(batchCount(BATCH_SIZE)).toBe(1);
    expect(batchCount(BATCH_SIZE + 1)).toBe(2);
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
  it("derives the status", () => {
    expect(nextStatus({ pending: 3, sent: 0, failed: 0 })).toBe("sending");
    expect(nextStatus({ pending: 0, sent: 2, failed: 1 })).toBe("sent");
    expect(nextStatus({ pending: 0, sent: 0, failed: 2 })).toBe("failed");
    expect(nextStatus({ pending: 0, sent: 0, failed: 0 })).toBe("sent");
  });
  it("builds a stable idempotency key", () => {
    expect(deliveryKey("A1", "U1")).toBe("cc-announcement-A1-U1");
  });
});

describe("renderBody", () => {
  it("escapes html, supports bold, bullets and https links only", () => {
    const r = renderBody('Hi <script>alert(1)</script> **bold**\n\n- a\n- b\n\n[ok](https://example.com/x?a=1&b=2) [bad](javascript:alert(1))', false);
    expect(r.html).not.toContain("<script>");
    expect(r.html).toContain("&lt;script&gt;");
    expect(r.html).toContain("<strong>bold</strong>");
    expect(r.html).toContain("<ul");
    expect(r.html).toContain('href="https://example.com/x?a=1&amp;b=2"');
    expect(r.html).not.toContain('href="javascript');
    expect(r.text).toContain("ok (https://example.com/x?a=1&b=2)");
  });
});

describe("renderAnnouncementEmail", () => {
  const mail = renderAnnouncementEmail(DRAFT);
  it("puts Arabic first, then English", () => {
    expect(mail.subject).toBe("دفعة جديدة · New cohort <open>");
    expect(mail.html.indexOf("مرحبًا بك")).toBeGreaterThan(-1);
    expect(mail.html.indexOf("مرحبًا بك")).toBeLessThan(mail.html.indexOf("Hello"));
    expect(mail.text.indexOf("مرحبًا بك")).toBeLessThan(mail.text.indexOf("Hello"));
  });
  it("escapes the subject and carries the kind-specific footer", () => {
    expect(mail.html).toContain("New cohort &lt;open&gt;");
    expect(mail.html).not.toContain("<open>");
    expect(mail.text).toContain("agreed to receive");
    const essential = renderAnnouncementEmail({ ...DRAFT, kind: "essential" });
    expect(essential.text).toContain("about your CAD Champions account");
  });
  it("marks tests", () => {
    expect(renderAnnouncementEmail(DRAFT, { testPrefix: true }).subject.startsWith("[Test] ")).toBe(true);
  });
});
