"use client";

import * as React from "react";
import Link from "next/link";

import { track, type CcEventName, type CcEventProps } from "@/lib/cad-champions/analytics";

/**
 * A link that records one analytics event on click. Internal hrefs use
 * next/link (pass ccPath URLs); `external` opens a new tab (WhatsApp).
 */
export function TrackLink<E extends CcEventName>({
  href,
  event,
  props,
  external = false,
  className,
  children,
  "aria-label": ariaLabel,
}: {
  href: string;
  event: E;
  props: CcEventProps[E];
  external?: boolean;
  className?: string;
  children: React.ReactNode;
  "aria-label"?: string;
}) {
  const onClick = () => track(event, props);
  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={className} onClick={onClick} aria-label={ariaLabel}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={className} onClick={onClick} aria-label={ariaLabel}>
      {children}
    </Link>
  );
}

/** In-page link that scrolls smoothly (instantly under reduced motion) and moves focus to the target. */
export function ScrollLink({ targetId, className, children }: { targetId: string; className?: string; children: React.ReactNode }) {
  return (
    <a
      href={`#${targetId}`}
      className={className}
      onClick={(e) => {
        const el = document.getElementById(targetId);
        if (!el) return;
        e.preventDefault();
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
        el.focus({ preventScroll: true });
        history.replaceState(null, "", `#${targetId}`);
      }}
    >
      {children}
    </a>
  );
}
