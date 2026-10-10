"use client";

// Step 3 of the client view, "Your wiring" (P5-04): the coloured wiring picture
// only, with plain labels ("Motion sensor", "Lamp relay", "Power adapter"),
// one button, and one plain safety line. The client never sees the Board /
// Power / Components steps: before the circuit is drawn the board and the power
// source are chosen from what is already known (lib/prototyping/auto-electronics)
// and saved in one write.
//
// The button's cost word follows the credit rules exactly (lib/credits): every
// circuit costs one credit, only an admin is free, and anything unknown reads
// as a credit, never as free.

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Loader2, Pencil, ShieldCheck } from "lucide-react";

import { AccessNote } from "@/components/credits/access-note";
import { BigButton, SoftBigButton } from "@/components/prototyping/client/step-card";
import { SvgFrame } from "@/components/prototyping/svg-frame";
import { track } from "@/lib/analytics";
import { creditsChanged, useCanUse } from "@/lib/credits/use-credits";
import { createClient } from "@/lib/supabase/client";
import type { LineMatch, ProjectBom } from "@/lib/prototyping/bom";
import { autoSetup } from "@/lib/prototyping/auto-electronics";
import { wiringCostKind } from "@/lib/prototyping/client-steps";
import { hardRules, type ProjectNetlist } from "@/lib/prototyping/netlist";
import { loadExamplePhotos } from "@/lib/prototyping/example-photos";
import { plainComponentLabels, plainNetLabels, plainPartName, plainPinLabel, type PlainWords } from "@/lib/prototyping/plain-names";
import { safetyNote } from "@/lib/prototyping/plain-safety";
import { setFact, EMPTY_SPEC, type Spec } from "@/lib/prototyping/spec";
import { renderWiring, wiringProducts, type WiringProduct } from "@/lib/prototyping/wiring-svg";
import type { Project } from "@/lib/supabase/types";

type Problem = "failed" | "busy";

export function ClientWiring({
  project,
  bom,
  matches,
  netlist,
  onSaved,
  patchProject,
}: {
  project: Project;
  bom: ProjectBom | null;
  matches: Map<string, LineMatch>;
  netlist: ProjectNetlist | null;
  onSaved: () => Promise<void>;
  patchProject: (changes: Partial<Project>) => PromiseLike<{ error: unknown }>;
}) {
  const t = useTranslations("ClientView");
  const locale = useLocale() === "ar" ? "ar" : "en";
  const access = useCanUse("wiring", project.id);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);

  const hasList = (bom?.lines ?? []).some((l) => l.kind === "electronics");
  const cost = wiringCostKind(access);
  const hard = useMemo(() => (netlist ? hardRules(netlist) : []), [netlist]);
  const products = useMemo(() => wiringProducts(bom?.lines ?? [], matches, locale), [bom, matches, locale]);

  // Parts without a store product yet show an example photo of the same kind.
  const [examples, setExamples] = useState<Map<string, WiringProduct>>(new Map());
  useEffect(() => {
    if (!netlist) return;
    const wanted = netlist.components.filter((c) => !products.get(c.bomId)?.image).map((c) => ({ bomId: c.bomId, fn: c.function }));
    if (!wanted.length) return;
    let cancelled = false;
    loadExamplePhotos(createClient(), wanted, locale)
      .then((m) => {
        if (!cancelled) setExamples(m);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [netlist, products, locale]);

  const words = useMemo<PlainWords>(
    () => ({ power: t("pinPower"), ground: t("pinGround"), signal: t("pinSignal"), connection: t("pinConnection") }),
    [t]
  );

  const svg = useMemo(() => {
    if (!netlist) return "";
    const names = plainComponentLabels(netlist.components, locale);
    const nets = plainNetLabels(netlist, names, words);
    const shown = new Map(products);
    for (const [id, ex] of examples) if (!shown.get(id)?.image) shown.set(id, ex);
    return renderWiring({
      netlist,
      // No red marks in the client's picture; the one safety line says what matters.
      flags: [],
      products: shown,
      labels: { noPhoto: t("wiringNoPhoto"), noProduct: t("wiringNoProduct"), example: t("wiringExample"), key: t("wiringKey") },
      plain: {
        component: (ref) => names.get(ref) ?? plainPartName("", locale),
        pin: (_ref, _id, type) => plainPinLabel(type, words),
        net: (name) => nets.get(name) ?? words.signal,
      },
    });
  }, [netlist, products, examples, words, locale, t]);

  const note = safetyNote({ netlist, levelFlags: bom?.levelFlags ?? [], hardCount: hard.length });

  async function draw() {
    setProblem(null);
    setBlocked(null);
    if (access && !access.allowed) {
      setBlocked(access.reason);
      track("circuit_generated", { cost: "blocked" });
      return;
    }
    setBusy(true);
    try {
      // Board and power are chosen for the client, in one write, before drawing.
      const setup = autoSetup({ route: project.build_route ?? null, spec: project.spec ?? null, brief: project.brief });
      if (setup.needsRoute || setup.needsPower) {
        const changes: Partial<Project> = {};
        if (setup.needsRoute) changes.build_route = setup.route;
        if (setup.needsPower) {
          const next: Spec = setFact(project.spec ?? EMPTY_SPEC, { id: "power", label: "Power" }, setup.power);
          changes.spec = next;
        }
        const { error } = await patchProject(changes);
        if (error) throw new Error("setup not saved");
      }

      const res = await fetch("/api/netlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: project.id, locale }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (data.error === "sign_in" || data.error === "no_credits") {
        setBlocked(data.error);
        track("circuit_generated", { cost: "blocked" });
      } else if (!res.ok) {
        setProblem(data.error === "paused" || data.error === "rate_limited" || data.error === "unavailable" ? "busy" : "failed");
      } else {
        track("circuit_generated", { cost: "credit" });
        await onSaved();
      }
      creditsChanged();
    } catch {
      setProblem("failed");
    }
    setBusy(false);
  }

  const label = (drawn: boolean) => t(drawn ? (cost === "free" ? "wiringRedrawFree" : "wiringRedrawCredit") : cost === "free" ? "wiringDrawFree" : "wiringDrawCredit");

  if (!hasList) return <p className="text-sm text-mutedtext">{t("wiringNeedParts")}</p>;

  return (
    <div className="space-y-4">
      {!netlist && <p className="text-sm leading-relaxed text-mutedtext">{t("wiringIntro")}</p>}

      {netlist && (
        <>
          <SvgFrame svg={svg} fileName="wiring" title={t("wiringTitle")} minHeight={480} simple />
          {note && (
            <p className="flex items-start gap-2 rounded-xl bg-panel/60 px-3 py-2.5 text-sm text-heading shadow-neu-inset">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
              <span>{t(`safety_${note}`)}</span>
            </p>
          )}
        </>
      )}

      {netlist ? (
        <SoftBigButton onClick={() => void draw()} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-4 w-4" />}
          {busy ? t("wiringDrawing") : label(true)}
        </SoftBigButton>
      ) : (
        <BigButton onClick={() => void draw()} disabled={busy}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {busy ? t("wiringDrawing") : label(false)}
        </BigButton>
      )}

      {problem && <p className="text-sm text-destructive">{t(problem === "busy" ? "wiringBusy" : "wiringFailed")}</p>}
      <AccessNote reason={blocked} step="wiring" projectName={project.name} />
    </div>
  );
}
