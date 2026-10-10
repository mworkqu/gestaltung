import type { NavGroup } from "@/components/dashboard/dashboard-nav";

// Every dashboard page the owner can reach, grouped by job. Used by the
// sidebar (dashboard layout) and by the "More" menu on the dashboard home, so
// the two can never drift apart.
export function adminNavGroups(t: (key: string) => string): NavGroup[] {
  return [
    {
      items: [
        { href: "/dashboard", label: t("home") },
        { href: "/dashboard/overview", label: t("numbers") },
      ],
    },
    {
      label: t("group_customers"),
      items: [
        { href: "/dashboard/leads", label: t("leads") },
        { href: "/dashboard/store/orders", label: t("partsOrders") },
        { href: "/dashboard/projects", label: t("projects") },
        { href: "/dashboard/credits", label: t("aiCredits") },
        { href: "/dashboard/reviews", label: t("reviews") },
      ],
    },
    {
      label: t("group_store"),
      items: [
        { href: "/dashboard/store/overview", label: t("overviewStore") },
        { href: "/dashboard/store", label: t("partsCatalog") },
        { href: "/dashboard/store/quick", label: t("quickAdd") },
        { href: "/dashboard/store/attributes", label: t("storeAttributes") },
        { href: "/dashboard/store/stock", label: t("stockToBuy") },
        { href: "/dashboard/store/fix", label: t("fixProducts") },
        { href: "/dashboard/store/restock", label: t("restock") },
        { href: "/dashboard/store/gaps", label: t("sourcingGaps") },
        { href: "/dashboard/store/occasions", label: t("occasions") },
        { href: "/dashboard/store/discounts", label: t("discounts") },
        { href: "/dashboard/store/youtube", label: t("youtube") },
      ],
    },
    {
      label: t("group_suppliers"),
      items: [
        { href: "/dashboard/store/suppliers", label: t("suppliers") },
        { href: "/dashboard/store/suppliers/lookup", label: t("findParts") },
        { href: "/dashboard/store/suppliers/voltaat", label: t("voltaatSync") },
      ],
    },
    {
      label: t("group_settings"),
      items: [
        { href: "/dashboard/usage", label: t("aiUsage") },
        { href: "/dashboard/notifications", label: t("notifications") },
        { href: "/inventory", label: t("inventory") },
      ],
    },
  ];
}
