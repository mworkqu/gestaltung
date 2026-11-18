"use client";

import { usePathname } from "@/i18n/navigation";
import { isCcPath } from "@/lib/cad-champions/cc-routing";

// D7: inside /dashboard the full site footer is replaced by one compact line
// (components/dashboard-footer.tsx). Both are server components passed in as
// props; usePathname (next-intl) is locale-stripped.
export function FooterGate({ compact, children }: { compact: React.ReactNode; children: React.ReactNode }) {
  const pathname = usePathname();
  // CAD Champions renders its own footer: neither the full nor the compact site footer there.
  if (isCcPath(pathname)) return null;
  const inDashboard = pathname === "/dashboard" || pathname.startsWith("/dashboard/");
  return <>{inDashboard ? compact : children}</>;
}
