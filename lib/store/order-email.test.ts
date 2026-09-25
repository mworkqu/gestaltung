import { describe, expect, it } from "vitest";

import { confirmationEmail, type OrderForEmail } from "@/lib/store/order-email";

const base: OrderForEmail = {
  id: "12345678-aaaa-bbbb-cccc-000000000000",
  customer_name: "Test",
  total_qar: 55,
  shipping_tier: "standard",
  split_shipments: false,
  shipping_qar: 20,
  handling_fee_qar: 10,
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
