"use client";

import { usePathname } from "@/i18n/navigation";

// The signed-in "app" areas (dashboard, inventory) render their
// own top bars, so the public marketing header is hidden there — only the
// footer stays. usePathname (next-intl) is locale-stripped, e.g. "/inventory".
const APP_PREFIXES = [
  "/dashboard",
  "/inventory",
];

/** Dashboard, inventory and the prototyping workspace: the app areas without the public header. */
export function isAppPath(pathname: string): boolean {
  return (
    APP_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/")) ||
    // The prototyping workspace carries its own bar (logo, back, language).
    /^\/projects\/[^/]+\/prototyping(\/|$)/.test(pathname)
  );
}

export function HeaderGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (isAppPath(pathname)) return null;
  return <>{children}</>;
}
