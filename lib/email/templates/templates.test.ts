import { describe, expect, it } from "vitest";

import { escapeHtml } from "@/lib/email";
import { NOTIFICATION_KINDS, renderNotification, samplePayload, type NotificationKind, type NotificationLinks } from "./index";
import { creditCount, formatDate } from "./layout";

const links: NotificationLinks = {
  siteUrl: "https://gestaltung360.com",
  projectsUrl: "https://gestaltung360.com/en/projects",
  storeUrl: "https://gestaltung360.com/en/store",
  projectUrl: "https://gestaltung360.com/en/projects/abc-123",
  unsubscribeUrl: "https://gestaltung360.com/api/notifications/unsubscribe?token=tok123",
  whatsappUrl: "https://wa.me/97466567410",
};
const LOCALES = ["en", "ar"] as const;
const EVIL = "<script>alert(1)</script>";

const payloads: Record<NotificationKind, Record<string, unknown>> = {
  credits_order_delivered: { ref: "r1", order_short: "A1B2C3D4", circuit_credits: 3, cad_credits: 1 },
  credits_admin_grant: { ref: "r2", amount: 5, credit_kind: "wiring", note: "Bank transfer 100 QAR" },
  first_project: { ref: "r3", project_id: "p1", project_name: "Plant monitor" },
  first_circuit: { ref: "r4", project_id: "p1", project_name: "Plant monitor", circuit_balance: 2, cad_balance: 1 },
  discount_ready: { ref: "r5", amount_qar: 20, valid_until: "2026-11-02T10:00:00Z" },
};

describe.each(NOTIFICATION_KINDS)("%s", (kind) => {
  describe.each(LOCALES)("%s", (locale) => {
    const out = renderNotification(kind, { locale, payload: payloads[kind], links });

    it("has a subject, text and html", () => {
      expect(out.subject.trim().length).toBeGreaterThan(0);
      expect(out.text.length).toBeGreaterThan(50);
      expect(out.html).toContain("<div");
      expect(out.subject).not.toMatch(/[\r\n]/);
    });

    it("carries the unsubscribe link in html and text", () => {
      expect(out.html).toContain(escapeHtml(links.unsubscribeUrl));
      expect(out.text).toContain(links.unsubscribeUrl);
      expect(out.text).toContain(locale === "ar" ? "إلغاء الاشتراك في هذه الرسائل" : "Unsubscribe from these emails");
    });

    it("has the brand strip, WhatsApp number and no bank details", () => {
      expect(out.html).toContain("236988");
      expect(out.text).toContain("236988");
      expect(out.html).toContain("+974 6656 7410");
      expect(out.text).toContain("+974 6656 7410");
      if (locale === "en") expect(out.html).toContain("Gestaltung for Trading and Services W.L.L · C.R. 236988");
      for (const s of [out.html, out.text]) {
        expect(s).not.toMatch(/IBAN/i);
        expect(s).not.toContain("QA94");
      }
    });

    it("sets lang/dir on the wrapper", () => {
      expect(out.html).toContain(`lang="${locale}"`);
      if (locale === "ar") expect(out.html).toContain('dir="rtl"');
      else expect(out.html).toContain('dir="ltr"');
    });

    it("does not throw on an empty payload", () => {
      const empty = renderNotification(kind, { locale, payload: {}, links: { ...links, projectUrl: undefined } });
      expect(empty.subject.trim().length).toBeGreaterThan(0);
      expect(empty.html).not.toContain("undefined");
      expect(empty.html).not.toContain("NaN");
      expect(empty.text).not.toContain("undefined");
      expect(empty.text).not.toContain("NaN");
    });

    it("does not throw on junk payload values", () => {
      const junk = renderNotification(kind, {
        locale,
        payload: { order_short: {}, circuit_credits: "abc", cad_credits: null, amount: [], note: 5, project_name: 42, amount_qar: "x", valid_until: "nonsense", circuit_balance: "z" },
        links,
      });
      expect(junk.html).not.toContain("NaN");
      expect(junk.text).not.toContain("NaN");
    });
  });
});

describe("credits_order_delivered", () => {
  it("EN: order number and counts, with singular/plural", () => {
    const o = renderNotification("credits_order_delivered", { locale: "en", payload: payloads.credits_order_delivered, links });
    expect(o.text).toContain("Congratulations — your order #A1B2C3D4 earned you 3 circuit credits and 1 CAD credit.");
    expect(o.html).toContain("#A1B2C3D4");
    expect(o.text).toContain(links.projectsUrl);
    const one = renderNotification("credits_order_delivered", {
      locale: "en",
      payload: { order_short: "Z9", circuit_credits: 1, cad_credits: 2 },
      links,
    });
    expect(one.text).toContain("1 circuit credit and 2 CAD credits.");
  });

  it("defaults to 3 and 1 when the numbers are missing", () => {
    const o = renderNotification("credits_order_delivered", { locale: "en", payload: { order_short: "Q1" }, links });
    expect(o.text).toContain("3 circuit credits and 1 CAD credit");
  });

  it("AR: order number and number agreement", () => {
    const o = renderNotification("credits_order_delivered", { locale: "ar", payload: payloads.credits_order_delivered, links });
    expect(o.text).toContain("A1B2C3D4");
    expect(o.text).toContain("3 أرصدة توصيل");
    expect(o.text).toContain("رصيد CAD واحدًا");
  });
});

describe("credits_admin_grant", () => {
  it("EN: amount and note", () => {
    const o = renderNotification("credits_admin_grant", { locale: "en", payload: payloads.credits_admin_grant, links });
    expect(o.text).toContain("You received 5 circuit credits: Bank transfer 100 QAR");
    expect(o.subject).toBe("You received 5 circuit credits");
  });

  it("EN: omits the colon when the note is empty", () => {
    const o = renderNotification("credits_admin_grant", { locale: "en", payload: { amount: 1, credit_kind: "cad", note: "  " }, links });
    expect(o.text).toContain("You received 1 CAD credit.");
    expect(o.text).not.toContain("credit:");
  });

  it("AR: amount and note", () => {
    const o = renderNotification("credits_admin_grant", { locale: "ar", payload: payloads.credits_admin_grant, links });
    expect(o.text).toContain("حصلت على 5 أرصدة توصيل: Bank transfer 100 QAR");
  });

  it("escapes a malicious note", () => {
    for (const locale of LOCALES) {
      const o = renderNotification("credits_admin_grant", { locale, payload: { amount: 2, credit_kind: "cad", note: EVIL }, links });
      expect(o.html).not.toContain("<script>");
      expect(o.html).toContain("&lt;script&gt;");
    }
  });
});

describe("first_project", () => {
  it("shows the project name and links to the project", () => {
    const en = renderNotification("first_project", { locale: "en", payload: payloads.first_project, links });
    expect(en.text).toContain("Welcome — your project is saved.");
    expect(en.html).toContain("Plant monitor");
    expect(en.html).toContain(`href="${links.projectUrl}"`);
    const ar = renderNotification("first_project", { locale: "ar", payload: payloads.first_project, links });
    expect(ar.html).toContain("Plant monitor");
  });

  it("falls back to the projects list without a project link", () => {
    const o = renderNotification("first_project", { locale: "en", payload: payloads.first_project, links: { ...links, projectUrl: undefined } });
    expect(o.html).toContain(`href="${links.projectsUrl}"`);
  });

  it("escapes a malicious project name", () => {
    for (const locale of LOCALES) {
      const o = renderNotification("first_project", { locale, payload: { project_name: EVIL }, links });
      expect(o.html).not.toContain("<script>");
      expect(o.html).toContain("&lt;script&gt;");
    }
  });
});

describe("first_circuit", () => {
  it("explains the credits and shows balances when present", () => {
    const en = renderNotification("first_circuit", { locale: "en", payload: payloads.first_circuit, links });
    expect(en.text).toContain("Your first circuit is ready. Your next ones use credits.");
    expect(en.text).toContain("Circuit credits: 2");
    expect(en.text).toContain("CAD credits: 1");
    const ar = renderNotification("first_circuit", { locale: "ar", payload: payloads.first_circuit, links });
    expect(ar.text).toContain("أرصدة التوصيل: 2");
  });

  it("omits the balance lines when the payload has none", () => {
    const o = renderNotification("first_circuit", { locale: "en", payload: { project_name: "X" }, links });
    expect(o.text).not.toContain("Circuit credits:");
  });

  it("escapes a malicious project name", () => {
    const o = renderNotification("first_circuit", { locale: "en", payload: { project_name: EVIL }, links });
    expect(o.html).not.toContain("<script>");
  });
});

describe("discount_ready", () => {
  it("EN: QAR 20 and the date", () => {
    const o = renderNotification("discount_ready", { locale: "en", payload: payloads.discount_ready, links });
    expect(o.text).toContain("You have QAR 20 off your next order, valid until 2 November 2026.");
    expect(o.html).toContain(`href="${links.storeUrl}"`);
  });

  it("AR: 20 ر.ق and the date", () => {
    const o = renderNotification("discount_ready", { locale: "ar", payload: payloads.discount_ready, links });
    expect(o.text).toContain("20 ر.ق");
    expect(o.text).toContain("2");
    expect(o.text).toContain("2026");
  });

  it("defaults to QAR 20 and drops the date when missing", () => {
    const o = renderNotification("discount_ready", { locale: "en", payload: {}, links });
    expect(o.text).toContain("You have QAR 20 off your next order.");
    expect(o.text).not.toContain("valid until");
  });

  it("uses the amount from the payload", () => {
    const o = renderNotification("discount_ready", { locale: "en", payload: { amount_qar: 40, valid_until: "2026-11-02" }, links });
    expect(o.text).toContain("QAR 40 off");
  });
});

describe("samplePayload", () => {
  it("renders every kind in both locales", () => {
    for (const kind of NOTIFICATION_KINDS) {
      for (const locale of LOCALES) {
        const o = renderNotification(kind, { locale, payload: samplePayload(kind), links });
        expect(o.subject.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("helpers", () => {
  it("creditCount: English plurals", () => {
    expect(creditCount(1, "circuit", "en")).toBe("1 circuit credit");
    expect(creditCount(0, "cad", "en")).toBe("0 CAD credits");
    expect(creditCount(3, "cad", "en")).toBe("3 CAD credits");
  });

  it("creditCount: Arabic agreement", () => {
    expect(creditCount(1, "circuit", "ar", "gen")).toBe("رصيد توصيل واحد");
    expect(creditCount(2, "circuit", "ar", "nom")).toBe("رصيدا توصيل");
    expect(creditCount(2, "cad", "ar", "acc")).toBe("رصيدي CAD");
    expect(creditCount(5, "circuit", "ar")).toBe("5 أرصدة توصيل");
    expect(creditCount(12, "circuit", "ar")).toBe("12 رصيد توصيل");
  });

  it("formatDate: Qatar time, Latin digits, null on junk", () => {
    expect(formatDate("2026-11-02T10:00:00Z", "en")).toBe("2 November 2026");
    expect(formatDate("2026-11-02T10:00:00Z", "ar")).toMatch(/^2 .+ 2026$/);
    expect(formatDate("nope", "en")).toBeNull();
    expect(formatDate(undefined, "en")).toBeNull();
  });
});
