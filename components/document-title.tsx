"use client";

import { useEffect } from "react";

/**
 * Sets the tab title from the client.
 *
 * F-033: the 404 showed the generic home title. The App Router gives a page
 * reached through `notFound()` the metadata of the nearest LAYOUT - a segment's
 * own `generateMetadata` is discarded when it throws, and `not-found.tsx`
 * cannot export `generateMetadata` at all. So there is no server-side way to
 * title it per locale. The page is a 404 and noindex, so nothing depends on the
 * title being in the served HTML; what the visitor sees is the tab, and this
 * sets that.
 */
export function DocumentTitle({ title }: { title: string }) {
  useEffect(() => {
    document.title = title;
  }, [title]);

  return null;
}
