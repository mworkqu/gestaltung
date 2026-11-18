// Pure helpers for the notification emails: links (and a cron-auth re-export).
// The implementation is lib/notifications/links-core.ts (no next/*, shared
// with the worker). Importing this file also loads lib/contact-phone-server,
// which registers the loader peekContactPhone() starts on a cold instance —
// exactly what importing it did before the split.

import "@/lib/contact-phone-server";

export { buildLinks, unsubscribeHeaders, unsubscribeUrl, type NotificationLinks } from "@/lib/notifications/links-core";

// Cron auth lives in lib/auth/cron.ts; re-exported so existing imports keep working.
export { isAuthorizedCron } from "@/lib/auth/cron";

// Re-exported so existing imports keep working; the implementation is lib/uuid.ts.
export { isUuid } from "@/lib/uuid";
