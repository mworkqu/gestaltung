"use client";

import type { ReactNode } from "react";

import { useCcSession } from "@/components/cad-champions/shell/session-context";

import { TrackLink } from "./track-link";

// Landing call to action. The page is prerendered for everyone, so it ships
// the signed-out version (sign-up link, which already sends a signed-in user
// straight on to `next`); once the browser session is known the label and href
// switch to the dashboard version. Display only: /dashboard enforces auth itself.
export function CcSessionCta({
  event,
  signedOutHref,
  signedInHref,
  signedOutLabel,
  signedInLabel,
  className,
  children,
}: {
  event: "cc_landing_hero_cta" | "cc_landing_final_cta";
  signedOutHref: string;
  signedInHref: string;
  signedOutLabel: string;
  signedInLabel: string;
  className?: string;
  children?: ReactNode;
}) {
  const signedIn = useCcSession().session !== null;
  return (
    <TrackLink href={signedIn ? signedInHref : signedOutHref} event={event} props={{ signed_in: signedIn }} className={className}>
      {signedIn ? signedInLabel : signedOutLabel}
      {children}
    </TrackLink>
  );
}
