// Notification emails (Phase I). The backend (cron drainer, unsubscribe route)
// imports exactly this surface. Pure rendering — nothing here sends anything.

import { render as creditsOrderDelivered } from "./credits-order-delivered";
import { render as creditsAdminGrant } from "./credits-admin-grant";
import { render as firstProject } from "./first-project";
import { render as firstCircuit } from "./first-circuit";
import { render as discountReady } from "./discount-ready";
import { orderStatusRenderer } from "./order-status";
import type { NotificationLinks, NotificationLocale, Rendered } from "./layout";

export type { NotificationLinks } from "./layout";

// Kind names live in THREE places that must stay in sync: the
// notification_outbox_kind_check constraint (0046, replaced by 0053),
// OUTBOX_KINDS (lib/notifications/decide.ts) and this list.
export const NOTIFICATION_KINDS = [
  "credits_order_delivered",
  "credits_admin_grant",
  "first_project",
  "first_circuit",
  "discount_ready",
  "order_confirmed",
  "order_paid",
  "order_sourcing",
  "order_shipped",
  "order_delivered",
  "order_cancelled",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const isNotificationKind = (v: unknown): v is NotificationKind =>
  typeof v === "string" && (NOTIFICATION_KINDS as readonly string[]).includes(v);

const RENDERERS = {
  credits_order_delivered: creditsOrderDelivered,
  credits_admin_grant: creditsAdminGrant,
  first_project: firstProject,
  first_circuit: firstCircuit,
  discount_ready: discountReady,
  order_confirmed: orderStatusRenderer("confirmed"),
  order_paid: orderStatusRenderer("paid"),
  order_sourcing: orderStatusRenderer("sourcing"),
  order_shipped: orderStatusRenderer("shipped"),
  order_delivered: orderStatusRenderer("delivered"),
  order_cancelled: orderStatusRenderer("cancelled"),
} as const;

export function renderNotification(
  kind: NotificationKind,
  args: { locale: NotificationLocale; payload: Record<string, unknown>; links: NotificationLinks }
): Rendered {
  const p = args.payload;
  const payload = p && typeof p === "object" && !Array.isArray(p) ? p : {};
  return RENDERERS[kind]({ locale: args.locale === "ar" ? "ar" : "en", payload, links: args.links });
}

/** The order id the sample payloads (and the admin test send) use. */
export const SAMPLE_ORDER_ID = "00000000-0000-0000-0000-000000000000";

/** Example payloads for the admin "send test to me". */
export function samplePayload(kind: NotificationKind): Record<string, unknown> {
  switch (kind) {
    case "credits_order_delivered":
      return { ref: "sample", order_short: "945EA389", circuit_credits: 3, cad_credits: 1 };
    case "credits_admin_grant":
      return { ref: "sample", amount: 5, credit_kind: "wiring", note: "Bank transfer 100 QAR, 2026-10-03" };
    case "first_project":
      return { ref: "sample", project_id: "00000000-0000-0000-0000-000000000000", project_name: "Plant monitor" };
    case "first_circuit":
      return {
        ref: "sample",
        project_id: "00000000-0000-0000-0000-000000000000",
        project_name: "Plant monitor",
        circuit_balance: 3,
        cad_balance: 1,
      };
    case "discount_ready":
      return {
        ref: "sample",
        amount_qar: 20,
        earned_at: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString().slice(0, 10),
        valid_until: new Date(Date.now() + 28 * 24 * 3600 * 1000).toISOString().slice(0, 10),
      };
    case "order_confirmed":
    case "order_paid":
    case "order_sourcing":
    case "order_shipped":
    case "order_delivered":
    case "order_cancelled":
      return {
        ref: "sample",
        order_id: SAMPLE_ORDER_ID,
        order_short: "945ea389",
        status: kind.slice(6),
        note: kind === "order_shipped" ? "Sample note: the driver will call you before noon." : null,
        total_qar: 53.5,
        payment_method: "fawran",
      };
  }
}
