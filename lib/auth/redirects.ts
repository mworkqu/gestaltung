import type { Role } from "@/lib/supabase/types";

// Single source of truth for "where does this user land after auth", returned
// as a LOCALE-AGNOSTIC app path (no /en or /ar prefix).
//   • next-intl's localized router/redirect (@/i18n/navigation) adds the locale.
//   • For Next's plain redirect() in a server component, prefix it yourself:
//       redirect(`/${locale}${dashboardPathForRole(role)}`)
//
// Stage 4: every role goes to the shared /dashboard. The switch is here on
// purpose so later stages can branch (super_admin console, workshop floor,
// client portal) without touching the auth forms.
export function dashboardPathForRole(role: Role): string {
  switch (role) {
    case "super_admin":
    case "workshop":
    case "client":
    default:
      return "/dashboard";
  }
}
