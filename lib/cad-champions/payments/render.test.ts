// Emails and receipt rendering (pure).
import { describe, expect, it } from "vitest";

import { renderOwnerProofAlert, renderPaymentEmail, type PaymentEmailData, type PaymentEmailKind } from "./emails";
import { getFawranDetails } from "./fawran";
import { formatReceiptNumber, getReceiptLetterhead, renderReceiptHtml, type ReceiptStrings } from "./receipts";

const data: PaymentEmailData = {
  locale: "ar",
  name: "سارة",
  planName: { en: "Online training", ar: "التدريب عبر الإنترنت" },
  amount: { en: "QAR 900", ar: "900 ر.ق." },
  referenceCode: "CAD-7K3P",
  url: "https://gestaltung360.com/cad-champions/ar/account/payments/x",
  expiresAt: { en: "16 October 2026", ar: "16 أكتوبر 2026" },
  activeUntil: { en: "12 January 2027", ar: "12 يناير 2027" },
  rejectReason: { en: "We have not received this transfer.", ar: "لم يصل التحويل." },
  fawran: { alias: "CR-236988", mobile: null, iban: "QA94 QIIB 0000 0000 1112 2207 6400 1", accountName: "GESTALTUNG FOR TRD AND SERV", bankName: "QIIB" },
};

describe("payment emails", () => {
  const kinds: PaymentEmailKind[] = ["reserved", "proof_received", "approved", "rejected", "expired", "reminder_7d", "reminder_1d"];
  it("renders every kind in both languages, student language first, with a text part", () => {
    for (const k of kinds) {
      const m = renderPaymentEmail(k, data);
      expect(m.subject).toContain(" · ");
      expect(m.html).toContain('dir="rtl"');
      expect(m.html).toContain('lang="en"');
      expect(m.text.length).toBeGreaterThan(20);
      expect(m.html).not.toContain("undefined");
    }
  });
  it("puts the IBAN only in the reservation email", () => {
    expect(renderPaymentEmail("reserved", data).html).toContain("QA94 QIIB");
    for (const k of kinds.filter((x) => x !== "reserved")) expect(renderPaymentEmail(k, data).html).not.toContain("QA94 QIIB");
  });
  it("shows the reject reason in both languages", () => {
    const m = renderPaymentEmail("rejected", { ...data, locale: "en" });
    expect(m.text).toContain("We have not received this transfer.");
    expect(m.text).toContain("لم يصل التحويل.");
  });
  it("owner alert is short English", () => {
    const m = renderOwnerProofAlert({ studentName: "Sara", amount: "QAR 900", referenceCode: "CAD-7K3P", bank: "qnb", adminUrl: "https://x/admin/payments" });
    expect(m.subject).toBe("CAD Champions payment proof: CAD-7K3P");
  });
});

describe("Fawran details", () => {
  it("uses env first, lib/company.ts as the fallback", () => {
    const fallback = getFawranDetails({});
    expect(fallback.alias).toBe("CR-236988");
    expect(fallback.accountName).toBe("GESTALTUNG FOR TRD AND SERV");
    expect(fallback.mobile).toBeNull();
    const env = getFawranDetails({ FAWRAN_ALIAS: "ALIAS-1", FAWRAN_MOBILE: "+974 5555 0000", FAWRAN_IBAN: " ", FAWRAN_BANK_NAME: "Bank X" });
    expect(env).toMatchObject({ alias: "ALIAS-1", mobile: "+974 5555 0000", iban: fallback.iban, bankName: "Bank X" });
  });
});

describe("receipt", () => {
  const pair = (k: string): [string, string] => [k, `${k}-ar`];
  const strings = Object.fromEntries(
    ["title", "number", "date", "billedTo", "plan", "cohort", "listPrice", "discount", "addon", "total", "method", "reference", "cr", "paidNote", "print", "htmlNote"].map((k) => [k, pair(k)]),
  ) as unknown as ReceiptStrings;

  it("formats the receipt number", () => {
    expect(formatReceiptNumber(1001)).toBe("CC-001001");
    expect(formatReceiptNumber(null)).toBe("");
  });
  it("letterhead: env CR/address, else lib/company.ts", () => {
    expect(getReceiptLetterhead({}).crNumber).toBe("236988");
    expect(getReceiptLetterhead({ CC_RECEIPT_CR_NUMBER: "999", CC_RECEIPT_ADDRESS_EN: "Somewhere" })).toMatchObject({ crNumber: "999", addressEn: "Somewhere" });
  });
  it("renders a bilingual, escaped receipt", () => {
    const html = renderReceiptHtml(
      {
        number: "CC-001001",
        date: ["14 October 2026", "14 أكتوبر 2026"],
        studentName: "Sara <script>",
        studentEmail: "sara@example.com",
        plan: ["Online training", "التدريب عبر الإنترنت"],
        cohort: null,
        listPrice: "QAR 1,000",
        discount: "QAR 100",
        addon: null,
        total: "QAR 900",
        method: ["Fawran", "فوري"],
        referenceCode: "CAD-7K3P",
      },
      strings,
      getReceiptLetterhead({}),
      { fallbackNote: true },
    );
    expect(html).toContain("Gestaltung360");
    expect(html).toContain("CC-001001");
    expect(html).toContain("التدريب عبر الإنترنت");
    expect(html).toContain("Sara &lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("window.print()");
  });
});
