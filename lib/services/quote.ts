// Engineer services — prices and quotes (owner, 2026-10-18). Pure.
//
// Prices live in store_settings 'engineer_services' (edited by the admin on
// /dashboard/engineering-jobs); ENGINEER_SERVICES_DEFAULT is the fallback.
// Copy never writes an amount: every number shown comes from a quote below.
// The server recomputes the quote from the saved Studio doc when the payment
// is created, so the browser can never set its own price.
//
//   assembly      — we wire and assemble the electronics and ship it connected:
//                   base + per component + per wire (connection).
//   cad_engineer  — a human engineer does the CAD: estimated hours from the
//                   project's complexity × the hourly rate, never below base.
//   pcb_gerber    — Engineers path: PCB layout + Gerber files ready for a PCB
//                   fab, checked by our engineer; ordering from the fab is
//                   handed over by hand (no fab account is opened).

import { z } from "zod";

import type { StudioDoc } from "@/lib/studio/schema";
import { actuatorTotals } from "@/lib/studio/actuators";

export const ENGINEER_SERVICES_KEY = "engineer_services";
export const SERVICE_KINDS = ["assembly", "cad_engineer", "pcb_gerber"] as const;
export type ServiceKind = (typeof SERVICE_KINDS)[number];

const money = z.number().finite().min(0).max(100000);
export const EngineerServicesSchema = z.object({
  assembly: z.object({ base_qar: money, per_component_qar: money, per_connection_qar: money, days: z.number().int().min(1).max(60) }),
  cad_engineer: z.object({ base_qar: money, hourly_qar: money, base_hours: z.number().min(0).max(100), days: z.number().int().min(1).max(60) }),
  pcb_gerber: z.object({ base_qar: money, per_component_qar: money, days: z.number().int().min(1).max(60) }),
  /** Every total rounds UP to this many QAR. */
  round_to_qar: z.number().int().min(1).max(100),
});
export type EngineerServices = z.infer<typeof EngineerServicesSchema>;

export const ENGINEER_SERVICES_DEFAULT: EngineerServices = {
  assembly: { base_qar: 100, per_component_qar: 5, per_connection_qar: 2, days: 3 },
  cad_engineer: { base_qar: 200, hourly_qar: 60, base_hours: 2, days: 2 },
  pcb_gerber: { base_qar: 150, per_component_qar: 5, days: 3 },
  round_to_qar: 5,
};

export function parseEngineerServices(raw: unknown): EngineerServices {
  const r = EngineerServicesSchema.safeParse(raw);
  return r.success ? r.data : ENGINEER_SERVICES_DEFAULT;
}

export type QuoteLine = { key: "base" | "components" | "connections" | "hours"; qty: number; unit_qar: number; qar: number };
export type Quote = { kind: ServiceKind; lines: QuoteLine[]; total_qar: number; days: number; hours?: number; components: number; connections: number };

const roundUp = (v: number, step: number) => Math.ceil(v / step) * step;

/** Wires to make: each net with n pins needs n − 1 connections. */
export function connectionCount(doc: Pick<StudioDoc, "netlist">): number {
  return doc.netlist.nets.reduce((s, n) => s + Math.max(0, n.pins.length - 1), 0);
}

/** Engineer hours for the CAD, from what the case has to hold and move. */
export function cadHours(doc: Pick<StudioDoc, "components" | "mech" | "enclosure" | "spec">, base: number): number {
  const movers = actuatorTotals(doc.spec).reduce((s, t) => s + t.count, 0);
  const raw = base + 0.25 * doc.components.length + 0.5 * movers + 0.25 * doc.mech.length + (doc.enclosure ? 1 : 0);
  return Math.round(raw * 2) / 2; // half hours
}

export function quoteService(kind: ServiceKind, doc: StudioDoc, prices: EngineerServices = ENGINEER_SERVICES_DEFAULT): Quote {
  const components = doc.components.length;
  const connections = connectionCount(doc);
  const step = prices.round_to_qar;
  if (kind === "assembly") {
    const p = prices.assembly;
    const lines: QuoteLine[] = [
      { key: "base", qty: 1, unit_qar: p.base_qar, qar: p.base_qar },
      { key: "components", qty: components, unit_qar: p.per_component_qar, qar: components * p.per_component_qar },
      { key: "connections", qty: connections, unit_qar: p.per_connection_qar, qar: connections * p.per_connection_qar },
    ];
    return { kind, lines, total_qar: roundUp(lines.reduce((s, l) => s + l.qar, 0), step), days: p.days, components, connections };
  }
  if (kind === "cad_engineer") {
    const p = prices.cad_engineer;
    const hours = cadHours(doc, p.base_hours);
    const byHours = hours * p.hourly_qar;
    const lines: QuoteLine[] = [{ key: "hours", qty: hours, unit_qar: p.hourly_qar, qar: byHours }];
    return { kind, lines, total_qar: roundUp(Math.max(p.base_qar, byHours), step), days: p.days, hours, components, connections };
  }
  const p = prices.pcb_gerber;
  const lines: QuoteLine[] = [
    { key: "base", qty: 1, unit_qar: p.base_qar, qar: p.base_qar },
    { key: "components", qty: components, unit_qar: p.per_component_qar, qar: components * p.per_component_qar },
  ];
  return { kind, lines, total_qar: roundUp(lines.reduce((s, l) => s + l.qar, 0), step), days: p.days, components, connections };
}

/** A service needs parts; assembly and PCB also need the wiring. */
export function serviceReady(kind: ServiceKind, doc: StudioDoc | null): boolean {
  if (!doc || doc.components.length === 0) return false;
  return kind === "cad_engineer" ? true : doc.netlist.nets.length > 0;
}
