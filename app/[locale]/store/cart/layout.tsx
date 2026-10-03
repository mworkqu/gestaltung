import { setRequestLocale } from "next-intl/server";

import { metaFor } from "@/lib/meta";
import { MessagesScope } from "@/components/i18n/messages-scope";

// The page is a client component, so its title lives here (audit #56).
export const generateMetadata = metaFor("cart");

export default async function Layout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  // Without this the scope's getMessages() would read request headers and make the page dynamic.
  setRequestLocale((await params).locale);
  // The page's client components get only the messages they use (lib/i18n/scopes.ts).
  return <MessagesScope scope="cart">{children}</MessagesScope>;
}
