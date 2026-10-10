import { canUse, spend } from "@/lib/credits/server";
import { getPart } from "@/lib/studio/library";
import { buildWiring } from "@/lib/studio/netlist";
import { emptyStudioDoc } from "@/lib/studio/schema";
import { loadDoc, updateDoc } from "@/lib/studio/server/doc";
import { creditDenied, WiringBody, wiringKey } from "@/lib/studio/server/http";
import { studioRequest } from "@/lib/studio/server/context";

// POST /api/studio/wiring — the circuit for the chosen parts. No AI call: the
// netlist and checks come from our rules (buildWiring). Credits follow the
// existing rule (canUse/spend, migration 0052): every circuit costs 1 wiring
// credit, admin free, guests are sent to sign in — exactly like /api/netlist.
// Charged only AFTER the circuit was built; a failure never charges.
// Idempotent re-open: when spec + parts equal what is saved and checks exist,
// the saved wiring is returned and nothing is charged.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const ctx = await studioRequest(request, WiringBody, { consent: false });
  if (ctx instanceof Response) return ctx;
  const { supabase, body, project } = ctx;

  const current = await loadDoc(supabase, project.id);
  if (current.ok && current.doc && current.doc.checks.length > 0 && current.doc.netlist.nets.length > 0) {
    const saved = current.doc;
    const userParts = (list: typeof body.components) => list.filter((c) => !c.auto);
    if (wiringKey(saved.spec, userParts(saved.components)) === wiringKey(body.spec, userParts(body.components)))
      return Response.json({
        components: saved.components,
        netlist: saved.netlist,
        checks: saved.checks,
        charged: false,
        reused: true,
        docVersion: current.version,
      });
  }

  const access = await canUse(supabase, "wiring", project.id);
  const denied = creditDenied(access);
  if (denied) return Response.json({ error: denied.error }, { status: denied.status });

  let wiring: ReturnType<typeof buildWiring>;
  try {
    wiring = buildWiring(body.components.filter((c) => !c.auto), body.spec, getPart, body.locale);
  } catch (e) {
    console.error("[studio/wiring] buildWiring failed:", e instanceof Error ? e.message : e);
    return Response.json({ error: "failed" }, { status: 500 });
  }

  const saved = await updateDoc(supabase, project.id, (doc) => ({
    ...(doc ?? emptyStudioDoc(body.spec)),
    spec: body.spec,
    components: wiring.components,
    netlist: wiring.netlist,
    checks: wiring.checks,
  }));

  const paid = await spend(supabase, "wiring", project.id);
  return Response.json({
    components: wiring.components,
    netlist: wiring.netlist,
    checks: wiring.checks,
    legacy: wiring.legacy,
    charged: paid.ok ? paid.charged : false,
    cost: access.cost,
    docVersion: saved.version,
  });
}
