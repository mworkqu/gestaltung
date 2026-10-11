import { describe, expect, it } from "vitest";

import {
  isLinkConflict,
  isOAuthProvider,
  oauthCallbackUrl,
  oauthErrorProvider,
  oauthScopes,
  parseEnabledProviders,
} from "./providers";

describe("parseEnabledProviders", () => {
  it("returns nothing for today's settings (email + anonymous only)", () => {
    expect(
      parseEnabledProviders({
        external: { email: true, anonymous_users: true, google: false, apple: false, azure: false, github: false },
        disable_signup: false,
      })
    ).toEqual([]);
  });

  it("returns the enabled ones in button order", () => {
    expect(parseEnabledProviders({ external: { azure: true, google: true, apple: false } })).toEqual(["google", "azure"]);
    expect(parseEnabledProviders({ external: { apple: true, azure: true, google: true } })).toEqual([
      "google",
      "apple",
      "azure",
    ]);
  });

  it("ignores providers we do not offer and non-true flags", () => {
    expect(parseEnabledProviders({ external: { github: true, google: "true", apple: 1 } })).toEqual([]);
  });

  it("copes with junk", () => {
    for (const junk of [null, undefined, "x", 42, [], {}, { external: null }, { external: "google" }]) {
      expect(parseEnabledProviders(junk)).toEqual([]);
    }
  });
});

describe("oauthCallbackUrl", () => {
  it("encodes next and the provider", () => {
    expect(oauthCallbackUrl("https://gestaltung360.com", "/en/projects/x/studio?step=wiring", "google")).toBe(
      "https://gestaltung360.com/api/auth/callback?next=%2Fen%2Fprojects%2Fx%2Fstudio%3Fstep%3Dwiring&provider=google"
    );
  });

  it("marks a guest link attempt and trims a trailing slash", () => {
    expect(oauthCallbackUrl("http://localhost:3000/", "/ar/dashboard", "azure", { link: true })).toBe(
      "http://localhost:3000/api/auth/callback?next=%2Far%2Fdashboard&provider=azure&link=1"
    );
  });
});

describe("helpers", () => {
  it("scopes: only Microsoft asks for email", () => {
    expect(oauthScopes("azure")).toBe("email");
    expect(oauthScopes("google")).toBeUndefined();
    expect(oauthScopes("apple")).toBeUndefined();
  });

  it("isOAuthProvider / oauthErrorProvider accept only our three", () => {
    expect(isOAuthProvider("google")).toBe(true);
    expect(isOAuthProvider("github")).toBe(false);
    expect(oauthErrorProvider("apple")).toBe("apple");
    expect(oauthErrorProvider(["azure", "google"])).toBe("azure");
    expect(oauthErrorProvider("<script>")).toBeNull();
    expect(oauthErrorProvider(undefined)).toBeNull();
  });

  it("isLinkConflict spots an account that already exists", () => {
    expect(isLinkConflict("identity_already_exists")).toBe(true);
    expect(isLinkConflict("email_exists")).toBe(true);
    expect(isLinkConflict(null, "Identity is already linked to another user")).toBe(true);
    expect(isLinkConflict("access_denied", "The user denied the request")).toBe(false);
    expect(isLinkConflict(undefined, undefined)).toBe(false);
  });
});
