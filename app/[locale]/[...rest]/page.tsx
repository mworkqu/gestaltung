import { notFound } from "next/navigation";

// Catch-all for URLs that match no page under a locale (e.g. /en/nothing-here).
// Without it Next renders the root not-found with no locale, header or footer;
// calling notFound() from inside [locale] shows app/[locale]/not-found.tsx
// (branded, inside the site layout) with a real 404 status.
export default function CatchAll() {
  notFound();
}
