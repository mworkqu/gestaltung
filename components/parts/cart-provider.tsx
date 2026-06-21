"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import type { CartItem, Part } from "@/lib/supabase/types";
import {
  addToCart,
  cartItemCount,
  cartTotal,
  getCart,
  removeFromCart,
  saveCart,
  updateCartQty,
} from "@/lib/parts/cart";
import { CART_KEY } from "@/lib/parts/constants";

type CartContextValue = {
  items: CartItem[];
  addItem: (part: Part, qty: number) => void;
  updateQty: (sku: string, qty: number) => void;
  removeItem: (sku: string) => void;
  clearCart: () => void;
  itemCount: number;
  totalQar: number;
  ready: boolean;
};

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  // `ready` avoids a hydration flash: the server renders an empty cart, then we
  // load from localStorage after mount.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setItems(getCart());
    setReady(true);

    // Keep multiple tabs in sync.
    function onStorage(e: StorageEvent) {
      if (e.key === CART_KEY) setItems(getCart());
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Persist on every change (but not before the initial load).
  useEffect(() => {
    if (ready) saveCart(items);
  }, [items, ready]);

  const addItem = useCallback(
    (part: Part, qty: number) => setItems((cur) => addToCart(cur, part, qty)),
    []
  );
  const updateQty = useCallback(
    (sku: string, qty: number) => setItems((cur) => updateCartQty(cur, sku, qty)),
    []
  );
  const removeItem = useCallback(
    (sku: string) => setItems((cur) => removeFromCart(cur, sku)),
    []
  );
  const clearCart = useCallback(() => setItems([]), []);

  const value = useMemo<CartContextValue>(
    () => ({
      items,
      addItem,
      updateQty,
      removeItem,
      clearCart,
      itemCount: cartItemCount(items),
      totalQar: cartTotal(items),
      ready,
    }),
    [items, addItem, updateQty, removeItem, clearCart, ready]
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within <CartProvider>");
  return ctx;
}
