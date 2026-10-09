import { describe, expect, it } from "vitest";
import { buildLinks, isAuthorizedCron, unsubscribeHeaders, unsubscribeUrl } from "./links";

describe("isAuthorizedCron", () => {
  it("rejects when the secret is unset or empty", () => {
    expect(isAuthorizedCron("Bearer anything", undefined)).toBe(false);
    expect(isAuthorizedCron("Bearer ", "")).toBe(false);
    expect(isAuthorizedCron("Bearer undefined", undefined)).toBe(false);
  });
  it("rejects a missing header", () => {
    expect(isAuthorizedCron(null, "s3cret")).toBe(false);
    expect(isAuthorizedCron(undefined, "s3cret")).toBe(false);
  });
  it("rejects a wrong secret or scheme", () => {
    expect(isAuthorizedCron("Bearer wrong", "s3cret")).toBe(false);
    expect(isAuthorizedCron("Bearer s3cret2", "s3cret")).toBe(false);
    expect(isAuthorizedCron("s3cret", "s3cret")).toBe(false);
    expect(isAuthorizedCron("Basic s3cret", "s3cret")).toBe(false);
  });
  it("accepts the exact bearer secret", () => {
    expect(isAuthorizedCron("Bearer s3cret", "s3cret")).toBe(true);
  });
});

describe("links", () => {
  const token = "11111111-2222-4333-8444-555555555555";
  const pid = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

  it("builds locale-prefixed links and a project link only for a real id", () => {
    const l = buildLinks({ siteUrl: "https://gestaltung360.com/", locale: "ar", token, kind: "first_project", projectId: pid });
    expect(l.siteUrl).toBe("https://gestaltung360.com");
    expect(l.projectsUrl).toBe("https://gestaltung360.com/ar/projects");
    expect(l.storeUrl).toBe("https://gestaltung360.com/ar/store");
    expect(l.projectUrl).toBe(`https://gestaltung360.com/ar/projects/${pid}`);
    expect(l.whatsappUrl).toMatch(/^https:\/\/wa\.me\//);
    expect(buildLinks({ siteUrl: "https://x.test", locale: "en", token, kind: "k", projectId: "../evil" }).projectUrl).toBeUndefined();
  });

  it("unsubscribe link carries token, kind and locale", () => {
    const u = new URL(unsubscribeUrl("https://gestaltung360.com", token, "first_circuit", "en"));
    expect(u.pathname).toBe("/api/notifications/unsubscribe");
    expect(u.searchParams.get("token")).toBe(token);
    expect(u.searchParams.get("kind")).toBe("first_circuit");
    expect(u.searchParams.get("locale")).toBe("en");
  });

  it("one-click headers", () => {
    const h = unsubscribeHeaders("https://x.test/u?token=a");
    expect(h["List-Unsubscribe"]).toBe("<https://x.test/u?token=a>");
    expect(h["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });
});

describe("buildLinks: order emails (0053)", () => {
  const ORDER = "1a2b3c4d-0000-4000-8000-000000000001";

  it("adds the order page and, with a secret, five rating links", () => {
    const l = buildLinks({ siteUrl: "https://gestaltung360.com/", locale: "ar", token: "t", kind: "order_delivered", orderId: ORDER, ratingSecret: "s3cret", transactional: true });
    expect(l.orderUrl).toBe(`https://gestaltung360.com/ar/orders/${ORDER}`);
    expect(l.ratingUrls).toHaveLength(5);
    expect(l.ratingUrls![0]).toContain(`/api/orders/rate?order=${ORDER}&score=1&l=ar&t=`);
    expect(l.ratingUrls![4]).toContain("score=5");
    expect(l.unsubscribeUrl).toBe("");
  });

  it("no rating links without a secret or a real order id; no order link for junk ids", () => {
    expect(buildLinks({ siteUrl: "https://x.test", locale: "en", token: "t", kind: "order_delivered", orderId: ORDER }).ratingUrls).toBeUndefined();
    const junk = buildLinks({ siteUrl: "https://x.test", locale: "en", token: "t", kind: "order_paid", orderId: "../../etc", ratingSecret: "s" });
    expect(junk.orderUrl).toBeUndefined();
    expect(junk.ratingUrls).toBeUndefined();
  });

  it("credit emails keep their unsubscribe link", () => {
    const l = buildLinks({ siteUrl: "https://x.test", locale: "en", token: "tok", kind: "discount_ready" });
    expect(l.unsubscribeUrl).toContain("/api/notifications/unsubscribe?token=tok");
  });
});
