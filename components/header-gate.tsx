"use client";

import { usePathname } from "@/i18n/navigation";

// The signed-in "app" areas (dashboard, inventory) render their
// own top bars, so the public marketing header is hidden there — only the
// footer stays. usePathname (next-intl) is locale-stripped, e.g. "/inventory".
const APP_PREFIXES = [
  "/dashboard",
  "/inventory",
  // Test-only dashboard photo fixture (lib/e2e-fixtures.ts): looks like the real dashboard.
  "/e2e-fixtures/dashboard",
];

/** Dashboard, inventory and the prototyping workspace: the app areas without the public header. */
export function isAppPath(pathname: string): boolean {
  return (
    APP_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/")) ||
    // The prototyping workspace carries its own bar (logo, back, language).
    /^\/projects\/[^/]+\/prototyping(\/|$)/.test(pathname)
  );
}

/** The printable pilot proposal (P2-05) is a sheet of paper: no site header or trust block, on screen or in print. */
export function isPrintSheetPath(pathname: string): boolean {
  return pathname === "/institutions/proposal";
}

export function HeaderGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (isAppPath(pathname) || isPrintSheetPath(pathname)) return null;
  return <>{children}</>;
}
