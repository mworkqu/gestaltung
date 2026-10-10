// Does this project use the AI prototyping workspace? A drawing-only /
// quote project (created by the drawing-request or quote forms) has no spec,
// parts list or circuit, so the client's page hides the "Prototyping" block.
// AI projects start with spec.aiConsent (lib/projects/create-from-chat.ts) or
// carry an analysed spec, a parts list or a circuit.

import { isAnalysed } from "@/lib/prototyping/spec";
import type { Project } from "@/lib/supabase/types";

export function projectUsesAi(p: Pick<Project, "spec" | "bom" | "netlist">): boolean {
  if (p.spec?.aiConsent) return true;
  if (isAnalysed(p.spec)) return true;
  if (p.bom?.lines && p.bom.lines.length > 0) return true;
  return Boolean(p.netlist);
}
