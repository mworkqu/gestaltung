import { describe, expect, it } from "vitest";
import { checkoutPrefill, fillEmpty, NO_PREFILL } from "./checkout-prefill";

const signedIn = { userId: "u1", fullName: " Mona ", phone: "+97433445566", email: "mona@example.com", guest: false };

describe("checkoutPrefill", () => {
  it("returns nothing for guests, anonymous sessions and failed reads", () => {
    expect(checkoutPrefill(null)).toEqual(NO_PREFILL);
    expect(checkoutPrefill({ ...signedIn, userId: null })).toEqual(NO_PREFILL);
    expect(checkoutPrefill({ ...signedIn, guest: true })).toEqual(NO_PREFILL);
  });
  it("prefills a signed-in customer and trims the name", () => {
    const r = checkoutPrefill(signedIn);
    expect(r.name).toBe("Mona");
    expect(r.email).toBe("mona@example.com");
    expect(r.phone).not.toBe("");
  });
  it("drops a stored phone or email that no longer validates", () => {
    const r = checkoutPrefill({ ...signedIn, phone: "123", email: "nope" });
    expect(r.phone).toBe("");
    expect(r.email).toBe("");
  });
});

describe("fillEmpty", () => {
  it("never overwrites what the visitor already typed", () => {
    expect(fillEmpty({ name: "Sam", phone: "", email: "" }, { name: "Mona", phone: "5", email: "m@x.com" })).toEqual({
      name: "Sam",
      phone: "5",
      email: "m@x.com",
    });
  });
});
