"use client";

import type { ComponentProps } from "react";

import { Link, useRouter } from "@/i18n/navigation";

// A product link that prefetches on intent only. The store grid has dozens of
// cards in view; the default viewport prefetch fired 235+ RSC requests on one
// visit. `prefetch={false}` turns that off, and pointer-enter / focus ask for
// the one route the visitor is heading to (focus keeps keyboard users on par).
type Props = Omit<ComponentProps<typeof Link>, "prefetch" | "onPointerEnter" | "onFocus"> & { href: string };

export function HoverPrefetchLink({ href, ...rest }: Props) {
  const router = useRouter();
  const warm = () => router.prefetch(href);
  return <Link {...rest} href={href} prefetch={false} onPointerEnter={warm} onFocus={warm} />;
}
