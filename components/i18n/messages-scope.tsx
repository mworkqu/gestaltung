import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";

import { pickMessages } from "@/lib/i18n/pick-messages";
import { MESSAGE_SCOPES, type MessageScope } from "@/lib/i18n/scopes";

// Server component: gives the client components below it the messages of one
// scope (lib/i18n/scopes.ts) instead of the whole file. Wrap a page's or a
// route layout's entire output in it. Locale, time zone and formats are
// inherited from the request config; only `messages` is narrowed.
// The page or layout rendering it must call setRequestLocale(locale) first,
// otherwise next-intl reads the locale from request headers and the route
// turns dynamic (no CDN cache).
export async function MessagesScope({ scope, children }: { scope: MessageScope; children: React.ReactNode }) {
  const messages = await getMessages();
  return (
    <NextIntlClientProvider messages={scope === "all" ? messages : pickMessages(messages, MESSAGE_SCOPES[scope])}>
      {children}
    </NextIntlClientProvider>
  );
}
