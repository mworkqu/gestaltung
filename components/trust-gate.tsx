"use client";

import { usePathname } from "@/i18n/navigation";
import { isAppPath } from "@/components/header-gate";

// The site-wide trust block (components/trust-block.tsx) is a server component
// passed in as children. It is hidden exactly where the public header is hidden
// (dashboard, inventory, prototyping workspace) and on /trust itself, which
// shows the same items in full. usePathname (next-intl) is locale-stripped.
export function TrustGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (isAppPath(pathname) || pathname === "/trust") return null;
  return <>{children}</>;
}
