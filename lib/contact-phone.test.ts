import { describe, expect, it } from "vitest";

import { COMPANY_WHATSAPP } from "@/lib/company";
import {
  contactPhoneFrom,
  contactPhoneFromSetting,
  DEFAULT_CONTACT_PHONE,
  parseContactPhoneInput,
  whatsappLink,
} from "@/lib/contact-phone";

describe("contact phone", () => {
  it("defaults to the number in lib/company.ts", () => {
    expect(DEFAULT_CONTACT_PHONE.display).toBe(COMPANY_WHATSAPP.display);
    expect(DEFAULT_CONTACT_PHONE.whatsappUrl).toBe(COMPANY_WHATSAPP.url);
    expect(DEFAULT_CONTACT_PHONE.tel).toBe("tel:+97433664265");
  });

  it("derives display, wa.me and tel: from one E.164 value", () => {
    expect(contactPhoneFrom("+97455512345")).toEqual({
      e164: "+97455512345",
      display: "+974 5551 2345",
      whatsappUrl: "https://wa.me/97455512345",
      tel: "tel:+97455512345",
    });
    expect(contactPhoneFrom("+442071234567").display).toBe("+442071234567");
  });

  it("accepts what the owner types in any common shape", () => {
    expect(parseContactPhoneInput("+974 5551 2345")).toBe("+97455512345");
    expect(parseContactPhoneInput("55512345")).toBe("+97455512345");
    expect(parseContactPhoneInput("00974 55512345")).toBe("+97455512345");
    expect(parseContactPhoneInput("hello")).toBeNull();
    expect(parseContactPhoneInput("")).toBeNull();
  });

  it("falls back to the default for a missing or broken setting", () => {
    expect(contactPhoneFromSetting(null)).toEqual(DEFAULT_CONTACT_PHONE);
    expect(contactPhoneFromSetting("nope")).toEqual(DEFAULT_CONTACT_PHONE);
    expect(contactPhoneFromSetting("+97455512345").e164).toBe("+97455512345");
    expect(contactPhoneFromSetting({ e164: "+97455512345" }).e164).toBe("+97455512345");
  });

  it("builds a prefilled WhatsApp link", () => {
    expect(whatsappLink(contactPhoneFrom("+97455512345"), "Hi there")).toBe("https://wa.me/97455512345?text=Hi%20there");
  });
});
