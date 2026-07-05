"use client";

import { usePathname } from "@/i18n/navigation";

// The signed-in "app" areas (dashboard, inventory, the job flow) render their
// own top bars, so the public marketing header is hidden there — only the
// footer stays. usePathname (next-intl) is locale-stripped, e.g. "/inventory".
const APP_PREFIXES = [
  "/dashboard",
  "/inventory",
  "/design/jobs",
  "/design/upload",
];

export function HeaderGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isApp = APP_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );
  if (isApp) return null;
  return <>{children}</>;
}
