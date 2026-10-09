"use client";

// Fires a funnel event when anything inside it is clicked (P1-08). For server
// pages, whose links cannot carry an onClick: wrap the link, keep navigation
// default. `display: contents` means the wrapper adds no box to the layout.
// Keyboard activation of a link also produces a click, so it is counted too.

import { track, type AnalyticsEvent, type AnalyticsEvents } from "@/lib/analytics";

export function TrackClick<E extends AnalyticsEvent>({
  event,
  params,
  children,
}: {
  event: E;
  params?: AnalyticsEvents[E];
  children: React.ReactNode;
}) {
  return (
    <span style={{ display: "contents" }} onClickCapture={() => track(event, params)}>
      {children}
    </span>
  );
}
