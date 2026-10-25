// The cross-template contract, for every kind in NOTIFICATION_KINDS in EN and
// AR: subject, escaping, no raw URL in what a reader sees, RTL for Arabic.
// Copy and per-kind wording are pinned in templates.test.ts.
import { describe, expect, it } from "vitest";

import { NOTIFICATION_KINDS, renderNotification, type NotificationKind, type NotificationLinks } from "./index";

const ORDER = "1a2b3c4d-0000-4000-8000-000000000001";
const RAW = `<b>x</b>&"`;
const ESCAPED = "&lt;b&gt;x&lt;/b&gt;&amp;&quot;";

const links: NotificationLinks = {
  siteUrl: "https://gestaltung360.com",
  projectsUrl: "https://gestaltung360.com/en/projects",
  storeUrl: "https://gestaltung360.com/en/store",
  projectUrl: "https://gestaltung360.com/en/projects/abc-123",
  orderUrl: `https://gestaltung360.com/en/orders/${ORDER}`,
  ratingUrls: [1, 2, 3, 4, 5].map((n) => `https://gestaltung360.com/api/orders/rate?order=${ORDER}&score=${n}&t=tok`),
  unsubscribeUrl: "https://gestaltung360.com/api/notifications/unsubscribe?token=tok123",
  whatsappUrl: "https://wa.me/97433664265",
};

// Every user-controlled string field any template reads is set to RAW.
const evil = {
  ref: "r1",
  project_id: "p1",
  order_id: ORDER,
  project_name: RAW,
  note: RAW,
  order_short: RAW,
  job_kind: RAW,
  credit_kind: RAW,
  status: RAW,
  amount: 2,
  amount_qar: 20,
  total_qar: 53.5,
  circuit_credits: 3,
  cad_credits: 1,
  circuit_balance: 2,
  cad_balance: 1,
} satisfies Record<string, unknown>;

/** What a reader sees: no <title>, no tags (so no hrefs). */
const visible = (html: string) => html.replace(/<title>[\s\S]*?<\/title>/, "").replace(/<[^>]+>/g, " ");

describe.each(NOTIFICATION_KINDS)("%s", (kind: NotificationKind) => {
  describe.each(["en", "ar"] as const)("%s", (locale) => {
    const out = renderNotification(kind, { locale, payload: evil, links });

    it("has a non-empty single-line subject", () => {
      expect(out.subject.trim()).not.toBe("");
      expect(out.subject).not.toMatch(/[\r\n]/);
    });

    it("never emits user HTML raw", () => {
      expect(out.html).not.toContain("<b>x</b>");
      expect(out.html).not.toContain(`&"`);
      expect(out.html).not.toContain(RAW);
    });

    it("shows no raw URL in the visible text of the html", () => {
      expect(visible(out.html)).not.toMatch(/https?:\/\//i);
    });

    it("sets direction: rtl for Arabic, ltr for English", () => {
      // The brand link keeps dir="ltr" inside an Arabic mail, so only the root and wrapper are pinned.
      expect(out.html).toContain(`<html lang="${locale}" dir="${locale === "ar" ? "rtl" : "ltr"}">`);
      expect(out.html).toContain(`<div dir="${locale === "ar" ? "rtl" : "ltr"}" lang="${locale}"`);
      if (locale === "en") expect(out.html).not.toContain('dir="rtl"');
    });
  });
});

describe("escaped user strings still reach the reader", () => {
  // Kinds that print a user-supplied name or note.
  it.each(["first_project", "first_circuit", "engineering_job_ready", "credits_admin_grant", "order_shipped"] as const)("%s", (kind) => {
    for (const locale of ["en", "ar"] as const) {
      expect(renderNotification(kind, { locale, payload: evil, links }).html).toContain(ESCAPED);
    }
  });
});
