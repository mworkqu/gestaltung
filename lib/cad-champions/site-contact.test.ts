import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_CONTACT_PHONE } from "@/lib/contact-phone";
import { buildWhatsAppUrl, getCcContact } from "./site-contact";

describe("buildWhatsAppUrl", () => {
  it("strips non-digits and encodes text", () => {
    expect(buildWhatsAppUrl("+974 3366-4265", "Hi there & مرحبا")).toBe(
      `https://wa.me/97433664265?text=${encodeURIComponent("Hi there & مرحبا")}`,
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
  it("uses the site-wide contact number (default without a database) and the default email", async () => {
    delete process.env.SUPPORT_EMAIL;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    expect(await getCcContact()).toEqual({ whatsappNumber: DEFAULT_CONTACT_PHONE.e164, supportEmail: "info@gestaltung360.com" });
  });
  it("takes the support email from SUPPORT_EMAIL", async () => {
    process.env.SUPPORT_EMAIL = "a@b.c";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    expect((await getCcContact()).supportEmail).toBe("a@b.c");
  });
});
