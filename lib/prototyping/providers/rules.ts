// The basic reader: the keyword rules in ../engine, shaped into the same
// contract a model returns. Server-only. No network, no key, no cost.
//
// It is both a selectable provider (ANALYSIS_PROVIDER=rules) and the fallback
// the route uses whenever the configured provider cannot answer.

import { getTranslations } from "next-intl/server";

import type { Analysis, AnalysisRequest } from "../analysis";
import { breakDown, detectDisciplines, readFacts, templateAppliesTo } from "../engine";
import type { AnalysisProvider } from "./types";

export async function readWithRules({ brief, locale }: AnalysisRequest): Promise<Analysis> {
  const t = await getTranslations({ locale, namespace: "Prototyping" });
  return {
    // Keyword rules cannot write a summary, so they do not pretend to.
    summary: "",
    disciplines: detectDisciplines(brief),
    requirements: readFacts(brief).map((f) => ({
      id: f.id,
      label: t(`fact_${f.id}`),
      value: f.value ?? t(`factValue_${f.valueKey}`, f.params ?? {}),
      // Keyword hits are claims about the brief; honestSources() (run on every
      // provider's answer in the route) downgrades any the text doesn't bear out.
      source: "brief",
    })),
    // The standard gaps are added by withStandardGaps() for every provider.
    questions: [],
    // A template's description goes only on a part whose name carries that
    // template's own trigger words (audit #5: no reservoir text on a mount).
    suggestedParts: breakDown(brief).map((p) => {
      const name = t(`part_${p.key}_name`);
      return { name, kind: p.kind, note: templateAppliesTo(p.key, name) ? t(`part_${p.key}_desc`) : "" };
    }),
    // Keywords cannot say what to buy or to what spec, so no bill of materials.
    bom: [],
  };
}

const rules: AnalysisProvider = {
  name: "rules",
  destination: null,
  configured: () => true,
  analyse: async (req) => ({ raw: await readWithRules(req) }),
};

export default rules;
