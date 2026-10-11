"use client";

// The small, always-loaded half of the instant store search (W7). Search boxes
// render their own input + form (plain GET to the results page, so Enter works
// before anything loads), give the input `comboboxAttrs(listId)` and mount
// <LazyStoreSuggest> once the visitor focuses or types (`useSuggestArmed`).
// The controller, the list and the fetch live in ./store-suggest, a separate
// chunk outside the page's first-load JS.

import { lazy, Suspense, useCallback, useState, type ComponentProps } from "react";

// React.lazy, not next/dynamic: it is only ever rendered in the browser (after a
// focus / keystroke), and next/dynamic's own client code would cost ~1.5 kB gz on
// every page that has a search box.
const StoreSuggest = lazy(() => import("./store-suggest"));

export function LazyStoreSuggest(props: ComponentProps<typeof StoreSuggest>) {
  return (
    <Suspense fallback={null}>
      <StoreSuggest {...props} />
    </Suspense>
  );
}

/** Static combobox attributes for the input (the controller updates aria-expanded / activedescendant). */
export const comboboxAttrs = (listId: string) =>
  ({
    role: "combobox",
    "aria-autocomplete": "list",
    "aria-expanded": false,
    "aria-controls": listId,
    autoComplete: "off",
  }) as const;

/** False until the first focus / keystroke; `arm` is safe to call on every event. */
export function useSuggestArmed(): [boolean, () => void] {
  const [armed, setArmed] = useState(false);
  const arm = useCallback(() => setArmed(true), []);
  return [armed, arm];
}
