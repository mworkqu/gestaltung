"use client";

import { usePathname } from "next/navigation";

import { editHref } from "@/lib/admin/return-to";

/**
 * Edit links from a client list (restock, stock) that bring the owner back to
 * this list and row after Save (D1). next/navigation's pathname keeps the
 * locale prefix, which returnTo needs; the server validates it again.
 */
export function useEditHref(): (partId: string, anchor?: string) => string {
  const pathname = usePathname();
  return (partId, anchor) => editHref(partId, `${pathname}${anchor ? `#${anchor}` : ""}`);
}
