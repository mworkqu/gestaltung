// Browser-side: record a demand signal without waiting for it. Failures are
// silent — a lost view must never break the page.

export type DemandKind = "view" | "add_to_cart" | "zero_search";

export function trackDemand(kind: DemandKind, data: { partId?: string; searchTerm?: string } = {}): void {
  if (typeof window === "undefined") return;
  try {
    const body = JSON.stringify({ kind, ...data, sourcePage: window.location.pathname + window.location.search });
    void fetch("/api/demand", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* ignore */
  }
}
