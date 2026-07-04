"use client";

import { usePathname } from "@/i18n/navigation";

// The store landing (homepage) ships its own design header + footer, so the
// global marketing chrome is suppressed there and rendered everywhere else.
// usePathname from next-intl strips the locale prefix, so "/" covers /en + /ar.
export function HomepageChromeGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/") return null;
  return <>{children}</>;
}
