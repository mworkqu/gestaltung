import { setRequestLocale } from "next-intl/server";

import { redirect } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { shouldRedirectEmptyCart } from "@/lib/store/checkout";
import { MessagesScope } from "@/components/i18n/messages-scope";
import CheckoutClient from "./checkout-client";

// Checkout with an empty cart goes to the cart, decided on the server so the
// form never flashes (site review A3). The cart lives in cart_items, owned by
// the visitor's (possibly anonymous) Supabase user; no session = no cart.
// Lines whose product is no longer visible are not counted, matching what the
// cart shows. If the count can't be read the page loads and the client-side
// fallback in checkout-client.tsx makes the same decision.
export const dynamic = "force-dynamic";

async function cartCount(): Promise<{ hasSession: boolean; itemCount: number | null }> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return { hasSession: true, itemCount: null };
  }
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { hasSession: false, itemCount: null };
    const { count, error } = await supabase
      .from("cart_items")
      .select("id, part:parts!inner(id)", { count: "exact", head: true })
      .eq("user_id", user.id);
    return { hasSession: true, itemCount: error ? null : count ?? 0 };
  } catch {
    return { hasSession: true, itemCount: null };
  }
}

export default async function CheckoutPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  if (shouldRedirectEmptyCart(await cartCount())) {
    redirect({ href: "/store/cart", locale });
  }

  return (
    <MessagesScope scope="checkout">
      <CheckoutClient />
    </MessagesScope>
  );
}
