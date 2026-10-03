import { describe, expect, it } from "vitest";

import {
  CONSENT_COOKIE,
  CONSENT_MAX_AGE_MS,
  GA_CONFIG,
  consentCookie,
  gaCommands,
  gtagSrc,
  parseConsent,
  readCookie,
  resolveConsent,
  serializeConsent,
  shouldLoadAnalytics,
} from "./consent";

const NOW = 1_790_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

describe("serialize / parse", () => {
  it("round-trips a choice", () => {
    expect(parseConsent(serializeConsent("accepted", NOW), NOW + 1000)).toEqual({ choice: "accepted", at: NOW });
    expect(parseConsent(serializeConsent("declined", NOW), NOW + 1000)?.choice).toBe("declined");
  });

  it("treats missing, empty and malformed values as not asked", () => {
    for (const bad of [null, undefined, "", "yes", "accepted", "accepted.abc", "maybe.1790000000000", "accepted.12"]) {
      expect(parseConsent(bad, NOW)).toBeNull();
    }
  });

  it("expires after 12 months (and not a day before)", () => {
    const raw = serializeConsent("declined", NOW);
    expect(parseConsent(raw, NOW + CONSENT_MAX_AGE_MS - DAY)).not.toBeNull();
    expect(parseConsent(raw, NOW + CONSENT_MAX_AGE_MS)).toBeNull();
  });

  it("ignores a value dated in the future", () => {
    expect(parseConsent(serializeConsent("accepted", NOW + 10 * DAY), NOW)).toBeNull();
  });
});

describe("resolveConsent", () => {
  it("is null before the visitor chose", () => {
    expect(resolveConsent({}, NOW)).toBeNull();
    expect(resolveConsent({ local: null, cookie: null }, NOW)).toBeNull();
  });

  it("uses whichever store survived", () => {
    expect(resolveConsent({ local: serializeConsent("accepted", NOW) }, NOW)).toBe("accepted");
    expect(resolveConsent({ cookie: serializeConsent("declined", NOW) }, NOW)).toBe("declined");
  });

  it("lets the newer value win when the stores disagree", () => {
    const older = serializeConsent("accepted", NOW - 5 * DAY);
    const newer = serializeConsent("declined", NOW - DAY);
    expect(resolveConsent({ local: older, cookie: newer }, NOW)).toBe("declined");
    expect(resolveConsent({ local: newer, cookie: older }, NOW)).toBe("declined");
  });

  it("asks again when only expired values remain", () => {
    const old = serializeConsent("accepted", NOW - 400 * DAY);
    expect(resolveConsent({ local: old, cookie: old }, NOW)).toBeNull();
  });
});

describe("cookie helpers", () => {
  it("reads our cookie out of document.cookie", () => {
    const header = `a=1; ${CONSENT_COOKIE}=declined.1790000000000; theme=dark`;
    expect(readCookie(header)).toBe("declined.1790000000000");
    expect(readCookie("a=1; b=2")).toBeNull();
    expect(readCookie(null)).toBeNull();
    expect(readCookie("gestaltung_consent_other=x")).toBeNull();
  });

  it("writes a first-party 12-month Lax cookie, Secure only on https", () => {
    const https = consentCookie("accepted", NOW, true);
    expect(https).toContain(`${CONSENT_COOKIE}=accepted.${NOW}`);
    expect(https).toContain("Max-Age=31536000");
    expect(https).toContain("Path=/");
    expect(https).toContain("SameSite=Lax");
    expect(https).toContain("Secure");
    expect(consentCookie("declined", NOW, false)).not.toContain("Secure");
    expect(https).not.toMatch(/Domain=/i);
  });
});

describe("analytics gate", () => {
  it("loads GA4 only after Accept with a valid measurement ID", () => {
    expect(shouldLoadAnalytics("accepted", "G-QXVQ4H05Y7")).toBe(true);
    expect(shouldLoadAnalytics("declined", "G-QXVQ4H05Y7")).toBe(false);
    expect(shouldLoadAnalytics(null, "G-QXVQ4H05Y7")).toBe(false);
    expect(shouldLoadAnalytics("accepted", undefined)).toBe(false);
    expect(shouldLoadAnalytics("accepted", "")).toBe(false);
    expect(shouldLoadAnalytics("accepted", "UA-123")).toBe(false);
    expect(shouldLoadAnalytics("accepted", 'G-X"></script>')).toBe(false);
  });

  it("configures GA4 with Google Signals and ad personalisation off", () => {
    expect(GA_CONFIG.allow_google_signals).toBe(false);
    expect(GA_CONFIG.allow_ad_personalization_signals).toBe(false);
    const cmds = gaCommands("G-ABC123", new Date(NOW));
    const config = cmds.find((c) => c[0] === "config");
    expect(config).toEqual(["config", "G-ABC123", { allow_google_signals: false, allow_ad_personalization_signals: false }]);
  });

  it("sends the consent default before js and config, denying every ad signal", () => {
    const cmds = gaCommands("G-ABC123", new Date(NOW));
    expect(cmds.map((c) => c[0])).toEqual(["consent", "js", "config"]);
    expect(cmds[0][2]).toMatchObject({
      analytics_storage: "granted",
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
    });
  });

  it("builds the gtag address from the ID only", () => {
    expect(gtagSrc("G-ABC123")).toBe("https://www.googletagmanager.com/gtag/js?id=G-ABC123");
  });
});
