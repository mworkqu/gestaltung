import { notFound } from "next/navigation";

// Catch-all for URLs that match no page under a locale (e.g. /en/nothing-here).
// Without it Next renders the root not-found with no locale, header or footer;
// calling notFound() from inside [locale] shows app/[locale]/not-found.tsx
// (branded, inside the site layout) with a real 404 status.
//
// No generateMetadata here: throwing notFound() discards this segment's
// metadata and Next falls back to the layout's, so it had no effect. The
// title is set in not-found.tsx instead (F-033).
export default function CatchAll() {
  notFound();
}
