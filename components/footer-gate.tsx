"use client";

import { usePathname } from "@/i18n/navigation";

// D7: inside /dashboard the full site footer is replaced by one compact line
// (components/dashboard-footer.tsx). Both are server components passed in as
// props; usePathname (next-intl) is locale-stripped.
export function FooterGate({ compact, children }: { compact: React.ReactNode; children: React.ReactNode }) {
  const pathname = usePathname();
  const inDashboard = pathname === "/dashboard" || pathname.startsWith("/dashboard/");
  return <>{inDashboard ? compact : children}</>;
}
