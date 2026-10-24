import { describe, expect, it } from "vitest";

import { parseLead, printFiles, quoteItems, MAX_FILES, MAX_ITEMS } from "./parse";
import { sourceFor } from "./sources";

const PHONE = "+974 5512 3456";
const USER = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const stl = (u = USER, p = PROJECT, f = "a.stl") => `cad-files/${u}/${p}/print/1700000000/${f}`;

function ok(body: unknown) {
  const r = parseLead(body);
  if (!r.ok) throw new Error(`expected ok, got ${r.code}`);
  return r.lead;
}
function fail(body: unknown) {
  const r = parseLead(body);
  if (r.ok) throw new Error("expected a refusal");
  return r;
}

describe("parseLead - valid bodies per source", () => {
  it("contact_form: trims, normalises the phone, keeps the message", () => {
    const l = ok({ source: "contact_form", name: "  Sara  ", phone: PHONE, email: " s@x.qa ", message: " hello ", locale: "ar" });
    expect(l).toMatchObject({ name: "Sara", phone: "+97455123456", email: "s@x.qa", message: "hello", locale: "ar", items: [], contactKind: null });
    expect(l.src.label).toBe("Contact form");
  });

  it("contact_form: kind tags the message once and sets the subject suffix", () => {
    const l = ok({ source: "contact_form", kind: "school_invoice", name: "T", phone: PHONE, message: "Class: A" });
    expect(l.message).toBe("School invoice request: Class: A");
    expect(l.contactKind?.subject).toBe(" (school invoice request)");
    const again = ok({ source: "contact_form", kind: "partner", name: "T", phone: PHONE, message: "partnership: hi" });
    expect(again.message).toBe("partnership: hi");
  });

  it("kind is ignored on other sources and for unknown/prototype keys", () => {
    expect(ok({ source: "store_callback", kind: "school", name: "T", phone: PHONE }).contactKind).toBeNull();
    expect(ok({ source: "contact_form", kind: "constructor", name: "T", phone: PHONE }).contactKind).toBeNull();
  });

  it("store_callback / unknown source use the callback fallback message", () => {
    const l = ok({ source: "store_callback", name: "T", phone: PHONE });
    expect(l.message).toBe("Store landing — requested a callback.");
    expect(ok({ source: "nope", name: "T", phone: PHONE }).src).toBe(sourceFor("store_callback"));
    expect(ok({ name: "T", phone: PHONE }).src).toBe(sourceFor(undefined));
  });

  it("drawing_request has its own fallback", () => {
    expect(ok({ source: "drawing_request", name: "T", phone: PHONE }).message).toBe("Help me draw it — new drawing project.");
  });

  it("bom_quote: items parsed, project id kept only when a UUID, note capped", () => {
    const l = ok({
      source: "bom_quote",
      name: "T",
      phone: PHONE,
      projectId: PROJECT,
      note: "x".repeat(2000),
      items: [{ function: " LED ", spec: " red ", quantity: 3 }],
    });
    expect(l.isQuote).toBe(true);
    expect(l.items).toEqual([{ function: "LED", spec: "red", quantity: 3 }]);
    expect(l.projectId).toBe(PROJECT);
    expect(l.note).toHaveLength(1000);
    expect(ok({ source: "bom_quote", name: "T", phone: PHONE, projectId: "../x", items: [{ function: "a" }] }).projectId).toBeNull();
  });

  it("studio_quote: name falls back, design name collapses whitespace and caps at 80", () => {
    const l = ok({
      source: "studio_quote",
      phone: PHONE,
      designName: "My   robot\n arm " + "z".repeat(100),
      items: [{ function: "Base" }],
      files: [stl()],
    });
    expect(l.name).toBe("Design Studio visitor");
    expect(l.isStudio).toBe(true);
    expect(l.designName).toHaveLength(80);
    expect(l.designName.startsWith("My robot arm zzz")).toBe(true);
    expect(l.files).toEqual([stl()]);
  });

  it("print_request: grams and raw files pass through", () => {
    const l = ok({ source: "print_request", phone: PHONE, totalGrams: "12.5", items: [{ function: "Body", spec: "PLA · 12 g" }] });
    expect(l.isPrint).toBe(true);
    expect(l.name).toBe("Design Studio visitor");
    expect(l.totalGrams).toBe(12.5);
    expect(l.files).toBeUndefined();
  });

  it("caps: name 120, email 160 (empty -> null), message 4000, phone 40", () => {
    const l = ok({ source: "contact_form", name: "n".repeat(300), phone: PHONE, email: "   ", message: "m".repeat(9000) });
    expect(l.name).toHaveLength(120);
    expect(l.email).toBeNull();
    expect(l.message).toHaveLength(4000);
    expect(ok({ name: "T", phone: PHONE, email: "e".repeat(300) }).email).toHaveLength(160);
  });

  it("non-string fields are stringified, not rejected", () => {
    expect(ok({ name: 42, phone: PHONE }).name).toBe("42");
  });

  it("locale narrows to en/ar", () => {
    expect(ok({ name: "T", phone: PHONE, locale: "fr" }).locale).toBe("en");
  });
});

describe("parseLead - refusals", () => {
  it("bad_request 400 for a non-object body", () => {
    for (const b of [null, "x", 5, [], undefined]) expect(fail(b)).toMatchObject({ code: "bad_request", status: 400 });
  });

  it("missing_fields 422: no name, no phone", () => {
    expect(fail({ phone: PHONE })).toMatchObject({ code: "missing_fields", status: 422 });
    expect(fail({ name: "T" })).toMatchObject({ code: "missing_fields", status: 422 });
    expect(fail({ name: "   ", phone: PHONE })).toMatchObject({ code: "missing_fields", status: 422 });
  });

  it("missing_fields 422: item sources need at least one valid item", () => {
    for (const source of ["bom_quote", "studio_quote", "print_request"]) {
      expect(fail({ source, name: "T", phone: PHONE })).toMatchObject({ code: "missing_fields", status: 422 });
      expect(fail({ source, name: "T", phone: PHONE, items: [{ function: "  " }, null] })).toMatchObject({ code: "missing_fields" });
    }
  });

  it("invalid_phone 422: fake and unreachable numbers", () => {
    for (const phone of ["00000000", "12345678", "abc", "+97411111111"]) {
      expect(fail({ name: "T", phone })).toMatchObject({ code: "invalid_phone", status: 422 });
    }
  });

  it("missing_fields wins over invalid_phone (checked first)", () => {
    expect(fail({ phone: "12345678" })).toMatchObject({ code: "missing_fields" });
  });
});

describe("quoteItems", () => {
  it("trims, caps fields, clamps quantity", () => {
    const out = quoteItems([
      { function: "f".repeat(200), spec: "s".repeat(300), quantity: 1e9 },
      { function: "b", quantity: 0 },
      { function: "c", quantity: "7.9" },
      { function: "d", quantity: "x" },
    ]);
    expect(out[0].function).toHaveLength(120);
    expect(out[0].spec).toHaveLength(200);
    expect(out.map((i) => i.quantity)).toEqual([100000, 1, 7, 1]);
  });

  it("drops items without a function and caps the list", () => {
    expect(quoteItems("nope")).toEqual([]);
    expect(quoteItems([{}, { function: "" }, 3 as unknown as object])).toEqual([]);
    expect(quoteItems(Array.from({ length: 100 }, () => ({ function: "a" })))).toHaveLength(MAX_ITEMS);
  });
});

describe("printFiles", () => {
  it("keeps only the caller's own cad-files folder for this project", () => {
    const own = stl();
    const out = printFiles(
      [own, own, stl("33333333-3333-4333-8333-333333333333"), stl(USER, "44444444-4444-4444-8444-444444444444"), "other-bucket/x.stl", 5, stl(USER, PROJECT, "a.exe")],
      USER,
      PROJECT,
    );
    expect(out).toEqual([own]);
  });

  it("matches ids case-insensitively", () => {
    expect(printFiles([stl()], USER.toUpperCase(), PROJECT.toUpperCase())).toEqual([stl()]);
  });

  it("returns nothing without a user, project or array; reads at most MAX_FILES entries", () => {
    expect(printFiles([stl()], null, PROJECT)).toEqual([]);
    expect(printFiles([stl()], USER, null)).toEqual([]);
    expect(printFiles("x", USER, PROJECT)).toEqual([]);
    const many = Array.from({ length: MAX_FILES + 10 }, (_, i) => stl(USER, PROJECT, `f${i}.stl`));
    expect(printFiles(many, USER, PROJECT)).toHaveLength(MAX_FILES);
  });
});
