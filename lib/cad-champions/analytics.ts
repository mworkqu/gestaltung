// CAD Champions analytics. Separate from the site's lib/analytics.ts.
// Dev: console.debug. Production: no-op (wire a provider here later). Never throws.

import type { CcEventName, CcEventProps } from "./analytics-events";

export { CC_EVENTS } from "./analytics-events";
export type { CcEventName, CcEventProps } from "./analytics-events";

export function track<E extends CcEventName>(event: E, props?: CcEventProps[E]): void {
  try {
    if (process.env.NODE_ENV !== "production") {
      console.debug("[cc-analytics]", event, props);
    }
  } catch {
    // analytics must never break the UI
  }
}
