"use client";

// The class-order marker in the URL. "Buy parts for all teams" fills the
// teacher's normal cart and sends them to /store/cart?class=<classId>; the cart
// carries that through to /store/checkout?class=<classId>, and checkout passes
// it to create_part_order as p_class_id.
//
// It is read from window.location in an effect, NOT from searchParams, so the
// cart and checkout pages keep the rendering mode they already have.
//
// The id is only a HINT. Every rule it affects is enforced in Postgres:
// class_order_delivery_quote() and create_part_order() both refuse a class the
// caller does not teach (migration 0097), so pasting somebody else's class id
// buys nothing and changes no price.

import { useEffect, useState } from "react";
import { UUID_RE } from "@/lib/uuid";

export const CLASS_ORDER_PARAM = "class";


/** The `class` query parameter, when it looks like an id. */
export function classOrderIdFrom(search: string): string | null {
  try {
    const raw = new URLSearchParams(search).get(CLASS_ORDER_PARAM);
    return raw && UUID_RE.test(raw) ? raw.toLowerCase() : null;
  } catch {
    return null;
  }
}

export function useClassOrderId(): string | null {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    setId(classOrderIdFrom(window.location.search));
  }, []);
  return id;
}

/** A path with the class marker kept, for the cart → checkout hand-off. */
export function withClassOrder(path: string, classId: string | null): string {
  if (!classId) return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}${CLASS_ORDER_PARAM}=${classId}`;
}
