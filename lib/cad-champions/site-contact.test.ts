import { afterEach, describe, expect, it } from "vitest";
import { buildWhatsAppUrl, getCcContact } from "./site-contact";

describe("buildWhatsAppUrl", () => {
  it("strips non-digits and encodes text", () => {
    expect(buildWhatsAppUrl("+974 6656-7410", "Hi there & مرحبا")).toBe(
      `https://wa.me/97466567410?text=${encodeURIComponent("Hi there & مرحبا")}`,
    );
  });
  it("returns null for empty or digit-less numbers", () => {
    expect(buildWhatsAppUrl(null, "x")).toBeNull();
    expect(buildWhatsAppUrl("", "x")).toBeNull();
    expect(buildWhatsAppUrl("abc", "x")).toBeNull();
  });
});

describe("getCcContact", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });
  it("defaults", () => {
    delete process.env.WHATSAPP_NUMBER;
    delete process.env.NEXT_PUBLIC_WHATSAPP_NUMBER;
    delete process.env.SUPPORT_EMAIL;
    expect(getCcContact()).toEqual({ whatsappNumber: null, supportEmail: "info@gestaltung360.com" });
  });
  it("prefers server env over public env", () => {
    process.env.WHATSAPP_NUMBER = "111";
    process.env.NEXT_PUBLIC_WHATSAPP_NUMBER = "222";
    process.env.SUPPORT_EMAIL = "a@b.c";
    expect(getCcContact()).toEqual({ whatsappNumber: "111", supportEmail: "a@b.c" });
  });
});
