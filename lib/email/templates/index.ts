// Notification emails (Phase I). The backend (cron drainer, unsubscribe route)
// imports exactly this surface. Pure rendering — nothing here sends anything.

import { render as creditsOrderDelivered } from "./credits-order-delivered";
import { render as creditsAdminGrant } from "./credits-admin-grant";
import { render as firstProject } from "./first-project";
import { render as firstCircuit } from "./first-circuit";
import { render as discountReady } from "./discount-ready";
import type { NotificationLinks, NotificationLocale, Rendered } from "./layout";

export type { NotificationLinks } from "./layout";

export const NOTIFICATION_KINDS = [
  "credits_order_delivered",
  "credits_admin_grant",
  "first_project",
  "first_circuit",
  "discount_ready",
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
} as const;

export function renderNotification(
  kind: NotificationKind,
  args: { locale: NotificationLocale; payload: Record<string, unknown>; links: NotificationLinks }
): Rendered {
  const p = args.payload;
  const payload = p && typeof p === "object" && !Array.isArray(p) ? p : {};
  return RENDERERS[kind]({ locale: args.locale === "ar" ? "ar" : "en", payload, links: args.links });
}

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
      return { ref: "sample", amount_qar: 20, valid_until: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString() };
  }
}
