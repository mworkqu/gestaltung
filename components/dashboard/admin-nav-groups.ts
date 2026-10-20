import type { NavGroup, NavTabSet } from "@/lib/admin/nav";

// Every dashboard page the owner can reach, in the four groups he chose
// (D2, 2026-10-11): Today · Sell · Build · Settings. Pages that belong
// together (catalog / quick add / specs, discounts / occasions, suppliers /
// lookup / Voltaat) stay separate routes and are joined by a tab bar
// (adminTabSets), so every old deep link keeps working. Pure: used by the
// sidebar (dashboard layout), the e2e fixture and the tests.
export function adminNavGroups(t: (key: string) => string): NavGroup[] {
  return [
    {
      label: t("group_today"),
      items: [{ href: "/dashboard", label: t("home"), icon: "home" }],
    },
    {
      label: t("group_sell"),
      items: [
        { href: "/dashboard/store/orders", label: t("partsOrders"), icon: "orders", badge: "orders" },
        {
          href: "/dashboard/store",
          label: t("partsCatalog"),
          icon: "products",
          match: ["/dashboard/store/quick", "/dashboard/store/attributes", "/dashboard/store/import", "/dashboard/store/new"],
        },
        { href: "/dashboard/store/fix", label: t("fixList"), icon: "fix", badge: "fix" },
        { href: "/dashboard/store/stock", label: t("restockNav"), icon: "restock", match: ["/dashboard/store/restock"] },
        { href: "/dashboard/store/discounts", label: t("discountsNav"), icon: "discounts", match: ["/dashboard/store/occasions"] },
        { href: "/dashboard/reviews", label: t("reviews"), icon: "reviews", badge: "reviews" },
      ],
    },
    {
      label: t("group_build"),
      items: [
        { href: "/dashboard/leads", label: t("leads"), icon: "leads", badge: "leads" },
        { href: "/dashboard/projects", label: t("projects"), icon: "projects" },
        { href: "/dashboard/credits", label: t("aiCredits"), icon: "credits" },
        { href: "/dashboard/studio-library", label: t("studioLibrary"), icon: "studio" },
      ],
    },
    {
      label: t("group_settings"),
      items: [
        { href: "/dashboard/store/suppliers", label: t("suppliersNav"), icon: "suppliers", match: ["/dashboard/store/overview"] },
        { href: "/dashboard/store/gaps", label: t("sourcingGaps"), icon: "gaps" },
        { href: "/dashboard/store/youtube", label: t("videosNav"), icon: "videos" },
        { href: "/dashboard/store/schools", label: t("schools"), icon: "schools" },
        { href: "/dashboard/usage", label: t("aiUsage"), icon: "usage" },
        { href: "/dashboard/ai-costs", label: t("aiCosts"), icon: "usage" },
        { href: "/dashboard/payments", label: t("payments"), icon: "credits" },
        { href: "/dashboard/engineering-jobs", label: t("engineeringJobs"), icon: "projects" },
        { href: "/dashboard/notifications", label: t("notifications"), icon: "notifications" },
        { href: "/dashboard/contact", label: t("contactInfo"), icon: "contact" },
        { href: "/inventory", label: t("inventory"), icon: "inventory" },
      ],
    },
  ];
}

/** Pages shown as tabs of one nav item. Each tab is still its own route. */
export function adminTabSets(t: (key: string) => string): NavTabSet[] {
  return [
    {
      id: "products",
      tabs: [
        { href: "/dashboard/store", label: t("tabCatalog") },
        { href: "/dashboard/store/quick", label: t("quickAdd") },
        { href: "/dashboard/store/attributes", label: t("storeAttributes") },
      ],
    },
    {
      id: "restock",
      tabs: [
        { href: "/dashboard/store/stock", label: t("stockToBuy") },
        { href: "/dashboard/store/restock", label: t("restock") },
      ],
    },
    {
      id: "discounts",
      tabs: [
        { href: "/dashboard/store/discounts", label: t("discounts") },
        { href: "/dashboard/store/occasions", label: t("occasions") },
      ],
    },
    {
      id: "suppliers",
      tabs: [
        { href: "/dashboard/store/suppliers", label: t("suppliers") },
        { href: "/dashboard/store/suppliers/lookup", label: t("findParts") },
        { href: "/dashboard/store/suppliers/voltaat", label: t("voltaatSync") },
        { href: "/dashboard/store/overview", label: t("overviewStore") },
      ],
    },
  ];
}
