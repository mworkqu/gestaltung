// Packs: how many pieces one store listing holds, and how many listings a
// need takes (P5-02).
//
// A listing is what the cart counts and what unit_price prices. Most listings
// hold one piece; some hold a pack ("M3 Screws – 5 Pcs", "Green LED (5 Pack)").
// The pack size is parts.pack_size when the owner set one above 1; otherwise
// it is read from the listing's name — the live catalogue stores 1 for most
// packs, which is how a line needing 4 screws put 4 packs of 5 in the cart.
//
// Pure and client-safe.

import { parsePack } from "./derive-attributes";

export type PackProduct = {
  pack_size?: number | null;
  name?: string | null;
  min_order_qty?: number | null;
};

/** Pieces in one listing: the stored pack size above 1, else the one its name states, else 1. */
export function packSizeOf(p: PackProduct | null | undefined): number {
  const stored = Math.trunc(Number(p?.pack_size));
  if (Number.isFinite(stored) && stored > 1) return stored;
  return parsePack(p?.name ?? "") ?? 1;
}

/** Listings to buy for `need` pieces: ceil(need ÷ pack), never below the minimum order. */
export function packsFor(need: number, p: PackProduct): number {
  const pieces = Math.max(1, Math.ceil(Number(need) || 1));
  return Math.max(Math.ceil(pieces / packSizeOf(p)), Math.trunc(Number(p.min_order_qty)) || 1);
}
