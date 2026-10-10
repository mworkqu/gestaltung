"use client";

// The client view of the workspace (P5-04): four plain steps on one page, top
// to bottom, each a card with one button.
//
//   1 Your idea     the chat and the short answers (chips)
//   2 Your parts    photo, name, quantity, price, ONE total, one button
//   3 Your wiring   the coloured wiring picture and one button
//   4 Get it made   the 3D model and "Ask for a quote"
//
// No readiness percentage, no requirement counters, no section tree, no
// legend, no open-items lists: those live in the Engineer view (workspace.tsx),
// which a super_admin can switch to. Everything here is derived from the same
// project data; nothing is stored for this view.

import { useCallback, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { useCart } from "@/components/parts/cart-provider";
import { IdeaStage } from "@/components/prototyping/idea-stage";
import { StepCard } from "@/components/prototyping/client/step-card";
import { ClientParts } from "@/components/prototyping/client/client-parts";
import { ClientWiring } from "@/components/prototyping/client/client-wiring";
import { ClientMakeBody, ClientModel } from "@/components/prototyping/client/client-make";
import { activeLines, type LineMatch, type ProjectBom } from "@/lib/prototyping/bom";
import type { CostState } from "@/lib/prototyping/bom-cost";
import { cartLineIds, kitPlan } from "@/lib/prototyping/kit-plan";
import { deriveClientSteps, needsWiring } from "@/lib/prototyping/client-steps";
import { autoSetup } from "@/lib/prototyping/auto-electronics";
import { hardRules } from "@/lib/prototyping/netlist";
import { isAnalysed, type Spec } from "@/lib/prototyping/spec";
import type { StoreCardPart } from "@/lib/store/catalog";
import { createClient } from "@/lib/supabase/client";
import type { Project, ProjectPart } from "@/lib/supabase/types";

export function ClientWorkspace({
  project,
  parts,
  bom,
  spec,
  matches,
  pricesState,
  electronicsActive,
  alsoUseful,
  briefDestination,
  startChat,
  turnstileEnabled,
  enclosureFrom,
  phonePrompt,
  onChanged,
  onSpec,
  onChoose,
  patchProject,
  reloadMatches,
}: {
  project: Project;
  parts: ProjectPart[];
  bom: ProjectBom | null;
  spec: Spec | null;
  matches: Map<string, LineMatch>;
  /** "ready" once the first store match is back (never QAR 0.00 before). */
  pricesState: CostState;
  electronicsActive: boolean;
  alsoUseful: StoreCardPart[];
  briefDestination: string | null;
  startChat: boolean;
  turnstileEnabled: boolean;
  /** service_prices.enclosure_from, formatted; null when unavailable. */
  enclosureFrom: string | null;
  phonePrompt: React.ReactNode;
  onChanged: () => Promise<void>;
  onSpec: (next: Spec) => void;
  onChoose: (lineId: string, productId: string | null) => Promise<void>;
  patchProject: (changes: Partial<Project>) => PromiseLike<{ error: unknown }>;
  reloadMatches: () => Promise<void>;
}) {
  const t = useTranslations("ClientView");
  const locale = useLocale() === "ar" ? "ar" : "en";
  const { items: cartItems, kitDiscountPct } = useCart();
  const [findState, setFindState] = useState<"idle" | "working" | "failed">("idle");

  const lines = activeLines(bom);
  const analysed = isAnalysed(spec);
  const hasElectronicsLines = (bom?.lines ?? []).some((l) => l.kind === "electronics");
  const wiring = needsWiring({ electronicsActive, hasElectronicsLines, hasNetlist: !!project.netlist });

  const inCart = cartLineIds(cartItems, project.id);
  const plan = kitPlan(lines, matches, { inCart, discountPct: kitDiscountPct });

  const steps = deriveClientSteps({
    analysed,
    hasParts: lines.length > 0,
    partsHandled: pricesState === "ready" && plan.add.length === 0 && plan.inCart.length > 0,
    needsWiring: wiring,
    wiringDone: !!project.netlist && hardRules(project.netlist).length === 0,
  });

  // "Find my electronics": the parts list for the boards, sensors and modules.
  // Board and power are chosen for the client first; nothing is drawn, so no
  // wiring credit is touched (the wiring is its own step).
  const findElectronics = useCallback(async () => {
    setFindState("working");
    try {
      const setup = autoSetup({ route: project.build_route ?? null, spec: project.spec ?? null, brief: project.brief });
      if (setup.needsRoute) {
        const { error } = await createClient().from("projects").update({ build_route: setup.route }).eq("id", project.id);
        if (error) throw new Error("route not saved");
      }
      const res = await fetch("/api/bom/electronics", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: project.id, locale, listOnly: true }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await onChanged();
      await reloadMatches();
      setFindState("idle");
    } catch {
      setFindState("failed");
    }
  }, [project.build_route, project.spec, project.brief, project.id, locale, onChanged, reloadMatches]);

  const body = (id: string) => {
    switch (id) {
      case "idea":
        return (
          <IdeaStage
            simple
            project={project}
            parts={parts}
            onChanged={onChanged}
            onSpec={onSpec}
            briefDestination={briefDestination}
            startChat={startChat}
            turnstileEnabled={turnstileEnabled}
          />
        );
      case "parts":
        return (
          <ClientParts
            projectId={project.id}
            analysed={analysed}
            lines={lines}
            matches={matches}
            plan={plan}
            pricesState={pricesState}
            needsElectronics={analysed && wiring && !hasElectronicsLines}
            onFindElectronics={() => void findElectronics()}
            findState={findState}
            onChoose={onChoose}
            alsoUseful={alsoUseful}
            phonePrompt={phonePrompt}
          />
        );
      case "wiring":
        return (
          <ClientWiring
            project={project}
            bom={bom}
            matches={matches}
            netlist={project.netlist ?? null}
            onSaved={onChanged}
            patchProject={patchProject}
          />
        );
      default:
        return <ClientMakeBody enclosureFrom={enclosureFrom} />;
    }
  };

  const title: Record<string, string> = {
    idea: t("stepIdeaTitle"),
    parts: t("stepPartsTitle"),
    wiring: t("stepWiringTitle"),
    make: t("stepMakeTitle"),
  };
  const intro: Record<string, string> = {
    idea: t("stepIdeaIntro"),
    parts: t("stepPartsIntro"),
    wiring: t("stepWiringIntro"),
    make: t("stepMakeIntro"),
  };

  return (
    <div className="space-y-5">
      {steps.map((s) => (
        <div key={s.id} className="space-y-5">
          <StepCard id={`client-${s.id}`} n={s.n} status={s.status} title={title[s.id]} intro={intro[s.id]}>
            {body(s.id)}
          </StepCard>
          {s.id === "make" && analysed && (
            <ClientModel projectId={project.id} projectName={project.name} brief={project.brief ?? ""} />
          )}
        </div>
      ))}
    </div>
  );
}
