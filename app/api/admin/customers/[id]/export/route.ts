import { buildCustomerExport, customerFileSlug } from "@/lib/admin/customer-export";
import { exportHandler } from "@/lib/admin/export-route";

// GET /api/admin/customers/<id>/export — everything the business holds about
// one person, in one JSON. super_admin only: checked against the caller's
// profile, and every read goes through RLS as that super_admin.
// ?download=1 sends it as a file.
//
// Local test hook, never in production: EXPORT_DEV_OWNER=1 also lets a person
// export their own record, so the export can be tried without an admin
// account. RLS still applies, so admin-only tables (leads, demand signals,
// the notification outbox) come back empty for them, and `_notes` says so.
// The shared flow is lib/admin/export-route.ts.

export const dynamic = "force-dynamic";

export const GET = exportHandler({
  load: buildCustomerExport,
  filename: (data, id) => {
    const customer = data.customer as { email?: string | null; fullName?: string | null };
    return `customer-${encodeURIComponent(customerFileSlug(customer.email ?? customer.fullName))}-${id.slice(0, 8)}.json`;
  },
  devOwner: {
    isOwn: async (_db, id, userId) => id === userId,
    exportedBy: "the customer themselves (EXPORT_DEV_OWNER dev hook)",
    note: "exported by the customer through the local dev hook: admin-only sections (leads, demand signals, notification outbox) are hidden by RLS",
  },
});
