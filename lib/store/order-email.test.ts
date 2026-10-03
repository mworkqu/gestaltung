import { describe, expect, it } from "vitest";

import { confirmationEmail, type OrderForEmail } from "@/lib/store/order-email";

const base: OrderForEmail = {
  id: "12345678-aaaa-bbbb-cccc-000000000000",
  customer_name: "Test",
  total_qar: 62,
  shipping_tier: "standard",
  split_shipments: false,
  shipping_qar: 50,
  handling_fee_qar: 0,
  promised_date: null,
  early_promised_date: null,
  held_by: null,
};

describe("confirmationEmail with on-request lines (0032)", () => {
  it("says 'to be confirmed' when nothing in the order is datable", () => {
    const m = confirmationEmail({ ...base, has_on_request: true }, [
      { part_name: "Relay", quantity: 2, unit_price_qar: 10, lead_time_class: null },
    ]);
    expect(m.subject).toContain("delivery date to be confirmed");
    expect(m.subject).not.toContain("arrives by");
    expect(m.html).toContain("to be confirmed");
    expect(m.html).toContain("Date to be confirmed");
    expect(m.html).not.toContain("Arrives by");
    expect(m.html).not.toContain("email you before it");
  });

  it("dates the datable lines and marks the rest in a mixed order", () => {
    const m = confirmationEmail({ ...base, promised_date: "2026-10-05", has_on_request: true }, [
      { part_name: "Relay", quantity: 1, unit_price_qar: 10, lead_time_class: null },
      { part_name: "Diode", quantity: 1, unit_price_qar: 2, lead_time_class: "in_stock" },
    ]);
    expect(m.subject).toContain("arrives by 5 October");
    expect(m.html).toContain("Arrives by <b>5 October</b>");
    expect(m.html).toContain("aren't included in this date");
    expect(m.html).toContain("<td>In stock</td>");
    expect(m.html).toContain("<td>Date to be confirmed</td>");
  });

  it("is unchanged for a fully datable order", () => {
    const m = confirmationEmail({ ...base, promised_date: "2026-10-05", has_on_request: false }, [
      { part_name: "Diode", quantity: 1, unit_price_qar: 2, lead_time_class: "in_stock" },
    ]);
    expect(m.html).not.toContain("to be confirmed");
    expect(m.html).not.toContain("يُؤكَّد لاحقاً");
    expect(m.html).toContain("email you before it");
  });

  it("derives on-request lines from items when has_on_request is absent (pre-0032)", () => {
    const m = confirmationEmail({ ...base, promised_date: "2026-10-05" }, [
      { part_name: "Relay", quantity: 1, unit_price_qar: 10, lead_time_class: null },
      { part_name: "Diode", quantity: 1, unit_price_qar: 2, lead_time_class: "in_stock" },
    ]);
    expect(m.html).toContain("aren't included in this date");
  });
});

describe("confirmationEmail shipping and handling rows (0044)", () => {
  const items = [{ part_name: "Diode", quantity: 6, unit_price_qar: 2, lead_time_class: "in_stock" }];

  it("leaves out the handling row in both languages when the fee is 0", () => {
    const m = confirmationEmail({ ...base, promised_date: "2026-10-05" }, items);
    expect(m.html).not.toContain("Handling fee");
    expect(m.html).not.toContain("رسوم التجهيز");
    expect(m.html).toContain("QAR 50.00");
  });

  it("shows the handling row in both languages when there is a fee", () => {
    const m = confirmationEmail({ ...base, handling_fee_qar: 10, total_qar: 72 }, items);
    expect(m.html).toContain("<td>Handling fee</td>");
    expect(m.html).toContain("<td>رسوم التجهيز</td>");
    expect(m.html).toContain("QAR 10.00");
  });

  it("says free delivery instead of QAR 0.00 when shipping is free", () => {
    const m = confirmationEmail({ ...base, shipping_qar: 0, total_qar: 300 }, items);
    expect(m.html).toContain("Free delivery");
    expect(m.html).toContain("توصيل مجاني");
    expect(m.html).not.toContain("QAR 0.00");
  });
});

describe("paymentBlock", async () => {
  const { paymentBlock } = await import("./order-email");
  const o = { id: "abcdef12-0000-0000-0000-000000000000", total_qar: 125.5 };
  it("gives the Fawran alias, amount and reference", () => {
    const html = paymentBlock({ ...o, payment_method: "fawran" }, "en");
    expect(html).toContain("CR-236988");
    expect(html).toContain("QAR 125.50");
    expect(html).toContain("abcdef12");
  });
  it("gives the IBAN and account name for a bank transfer", () => {
    const html = paymentBlock({ ...o, payment_method: "bank_transfer" }, "ar");
    expect(html).toContain("QA94 QIIB 0000 0000 1112 2207 6400 1");
    expect(html).toContain("GESTALTUNG FOR TRD AND SERV");
    expect(html).toContain("(Gestaltung for Trading and Services W.L.L)");
  });
  it("shows the legal name beside the Fawran account name", () => {
    const html = paymentBlock({ ...o, payment_method: "fawran" }, "en");
    expect(html).toContain("GESTALTUNG FOR TRD AND SERV (Gestaltung for Trading and Services W.L.L)");
  });
  it("says nothing when no method was recorded", () => {
    expect(paymentBlock({ ...o, payment_method: null }, "en")).toBe("");
  });
});
