import { describe, expect, it } from "vitest";

import { adminNavGroups, adminTabSets } from "@/components/dashboard/admin-nav-groups";
import { badgesFrom } from "@/lib/admin/nav-badges";
import { activeItemHref, badgeText, overviewRedirectPath, routeMatches, tabSetFor } from "@/lib/admin/nav";

const t = (k: string) => k;
const groups = adminNavGroups(t);
const items = groups.flatMap((g) => g.items);
const tabs = adminTabSets(t);

// Every page the sidebar reached before D2 (2026-10-11), minus /dashboard/overview
// (merged into Home, redirects to /dashboard#numbers).
const OLD_ROUTES = [
  "/dashboard",
  "/dashboard/leads",
  "/dashboard/store/orders",
  "/dashboard/projects",
  "/dashboard/credits",
  "/dashboard/reviews",
  "/dashboard/store/overview",
  "/dashboard/store",
  "/dashboard/store/quick",
  "/dashboard/store/attributes",
  "/dashboard/store/stock",
  "/dashboard/store/fix",
  "/dashboard/store/restock",
  "/dashboard/store/gaps",
  "/dashboard/store/occasions",
  "/dashboard/store/discounts",
  "/dashboard/store/youtube",
  "/dashboard/studio-library",
  "/dashboard/store/suppliers",
  "/dashboard/store/suppliers/lookup",
  "/dashboard/store/suppliers/voltaat",
  "/dashboard/usage",
  "/dashboard/ai-costs",
  "/dashboard/payments",
  "/dashboard/notifications",
  "/inventory",
];

describe("admin nav groups", () => {
  it("has the four groups the owner chose, in order", () => {
    expect(groups.map((g) => g.label)).toEqual(["group_today", "group_sell", "group_build", "group_settings"]);
  });

  it("lists the items per group as in the brief", () => {
    expect(groups.map((g) => g.items.map((i) => i.href))).toEqual([
      ["/dashboard"],
      [
        "/dashboard/store/orders",
        "/dashboard/store",
        "/dashboard/store/fix",
        "/dashboard/store/stock",
        "/dashboard/store/discounts",
        "/dashboard/reviews",
      ],
      ["/dashboard/leads", "/dashboard/projects", "/dashboard/credits", "/dashboard/studio-library"],
      [
        "/dashboard/store/suppliers",
        "/dashboard/store/gaps",
        "/dashboard/store/youtube",
        "/dashboard/usage",
        "/dashboard/ai-costs",
        "/dashboard/payments",
        "/dashboard/engineering-jobs",
        "/dashboard/notifications",
        "/dashboard/contact",
        "/inventory",
      ],
    ]);
  });

  it("gives every item an icon and unique hrefs", () => {
    expect(items.every((i) => !!i.icon)).toBe(true);
    expect(new Set(items.map((i) => i.href)).size).toBe(items.length);
  });

  it("puts badges on orders, fix, leads and reviews only", () => {
    expect(Object.fromEntries(items.filter((i) => i.badge).map((i) => [i.href, i.badge]))).toEqual({
      "/dashboard/store/orders": "orders",
      "/dashboard/store/fix": "fix",
      "/dashboard/leads": "leads",
      "/dashboard/reviews": "reviews",
    });
  });

  it("still reaches every old route, as an item or a tab", () => {
    const reachable = new Set([...items.map((i) => i.href), ...tabs.flatMap((s) => s.tabs.map((x) => x.href))]);
    for (const route of OLD_ROUTES) expect(reachable.has(route), route).toBe(true);
  });

  it("lights up exactly one item for every old route", () => {
    for (const route of OLD_ROUTES) expect(activeItemHref(route, items), route).not.toBeNull();
  });
});

describe("active-route matching", () => {
  const cases: [string, string | null][] = [
    ["/dashboard", "/dashboard"],
    ["/dashboard/", "/dashboard"],
    ["/dashboard/store", "/dashboard/store"],
    ["/dashboard/store/quick", "/dashboard/store"],
    ["/dashboard/store/attributes", "/dashboard/store"],
    ["/dashboard/store/import", "/dashboard/store"],
    ["/dashboard/store/abc-123/edit", "/dashboard/store"],
    ["/dashboard/store/orders", "/dashboard/store/orders"],
    ["/dashboard/store/orders/abc", "/dashboard/store/orders"],
    ["/dashboard/store/fix", "/dashboard/store/fix"],
    ["/dashboard/store/restock", "/dashboard/store/stock"],
    ["/dashboard/store/occasions", "/dashboard/store/discounts"],
    ["/dashboard/store/suppliers/voltaat", "/dashboard/store/suppliers"],
    ["/dashboard/store/suppliers/import", "/dashboard/store/suppliers"],
    ["/dashboard/store/overview", "/dashboard/store/suppliers"],
    ["/dashboard/store/gaps", "/dashboard/store/gaps"],
    ["/dashboard/leads", "/dashboard/leads"],
    ["/inventory/projects", "/inventory"],
    ["/dashboard/storefront", null],
    ["/projects", null],
  ];
  for (const [path, want] of cases) {
    it(`${path} -> ${want}`, () => {
      expect(activeItemHref(path, items)).toBe(want);
    });
  }

  it("matches /dashboard only exactly", () => {
    expect(routeMatches("/dashboard/leads", "/dashboard")).toBe(false);
    expect(routeMatches("/dashboard", "/dashboard")).toBe(true);
    expect(routeMatches("/dashboard/store-x", "/dashboard/store")).toBe(false);
  });
});

describe("tab sets", () => {
  it("shows the products tabs on catalog, quick add and specs only", () => {
    expect(tabSetFor("/dashboard/store", tabs)?.id).toBe("products");
    expect(tabSetFor("/dashboard/store/quick", tabs)?.id).toBe("products");
    expect(tabSetFor("/dashboard/store/attributes/", tabs)?.id).toBe("products");
    expect(tabSetFor("/dashboard/store/new", tabs)).toBeNull();
    expect(tabSetFor("/dashboard/store/abc/edit", tabs)).toBeNull();
  });

  it("joins discounts + occasions, suppliers + lookup + Voltaat, stock + restock", () => {
    expect(tabSetFor("/dashboard/store/occasions", tabs)?.id).toBe("discounts");
    expect(tabSetFor("/dashboard/store/suppliers/lookup", tabs)?.id).toBe("suppliers");
    expect(tabSetFor("/dashboard/store/suppliers/voltaat", tabs)?.id).toBe("suppliers");
    expect(tabSetFor("/dashboard/store/restock", tabs)?.id).toBe("restock");
    expect(tabSetFor("/dashboard/store/orders", tabs)).toBeNull();
  });

  it("only uses tab routes that belong to the item they sit under", () => {
    for (const set of tabs) {
      const owners = new Set(set.tabs.map((x) => activeItemHref(x.href, items)));
      expect(owners.size, set.id).toBe(1);
    }
  });
});

describe("badges", () => {
  it("shows nothing for 0, unknown or bad numbers", () => {
    expect(badgeText(0)).toBeNull();
    expect(badgeText(undefined)).toBeNull();
    expect(badgeText(null)).toBeNull();
    expect(badgeText(Number.NaN)).toBeNull();
    expect(badgeText(-3)).toBeNull();
  });

  it("caps at 99+", () => {
    expect(badgeText(7)).toBe("7");
    expect(badgeText(99)).toBe("99");
    expect(badgeText(100)).toBe("99+");
  });

  it("drops counts that could not be read", () => {
    expect(badgesFrom({ orders: 2, fix: null, leads: 0, reviews: null })).toEqual({ orders: 2, leads: 0 });
  });
});

describe("overview redirect", () => {
  it("sends /dashboard/overview to Home's numbers section", () => {
    expect(overviewRedirectPath("en")).toBe("/en/dashboard#numbers");
    expect(overviewRedirectPath("ar")).toBe("/ar/dashboard#numbers");
  });
});
