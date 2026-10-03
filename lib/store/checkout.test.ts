import { describe, expect, it } from "vitest";

import { checkoutRpcError, shouldRedirectEmptyCart, validateCheckoutEmail } from "@/lib/store/checkout";

describe("shouldRedirectEmptyCart", () => {
  it("redirects without a session", () => {
    expect(shouldRedirectEmptyCart({ hasSession: false, itemCount: null })).toBe(true);
    expect(shouldRedirectEmptyCart({ hasSession: false, itemCount: 3 })).toBe(true);
  });
  it("redirects an empty cart", () => {
    expect(shouldRedirectEmptyCart({ hasSession: true, itemCount: 0 })).toBe(true);
  });
  it("lets a cart with items through", () => {
    expect(shouldRedirectEmptyCart({ hasSession: true, itemCount: 1 })).toBe(false);
  });
  it("lets the page load when the count is unknown", () => {
    expect(shouldRedirectEmptyCart({ hasSession: true, itemCount: null })).toBe(false);
  });
});

describe("validateCheckoutEmail", () => {
  it("requires an email for bank transfer", () => {
    expect(validateCheckoutEmail("", "bank_transfer")).toBe("emailRequiredBank");
    expect(validateCheckoutEmail("   ", "bank_transfer")).toBe("emailRequiredBank");
    expect(validateCheckoutEmail("not-an-email", "bank_transfer")).toBe("emailInvalid");
    expect(validateCheckoutEmail("pay@example.qa", "bank_transfer")).toBeNull();
  });
  it("keeps email optional for other methods, but checks one that is given", () => {
    expect(validateCheckoutEmail("", "cash_on_delivery")).toBeNull();
    expect(validateCheckoutEmail("", "fawran")).toBeNull();
    expect(validateCheckoutEmail("x@y", "fawran")).toBe("emailInvalid");
    expect(validateCheckoutEmail("x@y.com", "cash_on_delivery")).toBeNull();
  });
});

describe("checkoutRpcError", () => {
  it("maps the server's refusals", () => {
    expect(checkoutRpcError("email is required for bank transfer")).toBe("emailRequiredBank");
    expect(checkoutRpcError("order total must be greater than zero")).toBe("totalZero");
    expect(checkoutRpcError("Hall effect sensor is available on request only")).toBe("cartBlocked");
    expect(checkoutRpcError("part not available")).toBe("errorSubmit");
    expect(checkoutRpcError(undefined)).toBe("errorSubmit");
  });
});
