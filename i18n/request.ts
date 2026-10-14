import { getRequestConfig } from "next-intl/server";
import { routing, type Locale } from "./routing";

// CAD Champions strings live in their own files (messages/cad-champions/{locale}/*.json)
// and are merged under the "CC" namespace. Server-only: the client receives only
// what a layout passes to NextIntlClientProvider, so the site's pages ship no CC text.
const CC_MESSAGE_FILES = ["shell", "pages", "errors", "ui", "gallery"] as const;

async function loadCcMessages(locale: Locale) {
  const entries = await Promise.all(
    CC_MESSAGE_FILES.map(async (file) => [
      file,
      (await import(`../messages/cad-champions/${locale}/${file}.json`)).default,
    ]),
  );
  return Object.fromEntries(entries);
}

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale: Locale =
    requested && routing.locales.includes(requested as Locale)
      ? (requested as Locale)
      : routing.defaultLocale;

  const [site, cc] = await Promise.all([
    import(`../messages/${locale}.json`).then((m) => m.default),
    loadCcMessages(locale),
  ]);

  return { locale, messages: { ...site, CC: cc } };
});
