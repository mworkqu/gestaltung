// Landing FAQ as data (pure). Each item points at its message ids under
// CC.landing (messages/cad-champions/{en,ar}/landing.json → faq.items.<id>.q|a),
// so an admin editor can later reorder, hide or replace items without touching
// the page. The same list feeds the accordion and the FAQPage JSON-LD.

export const CC_FAQ_IDS = [
  "free",
  "software",
  "competitionSoftware",
  "mac",
  "noSoftware",
  "duration",
  "files",
  "results",
  "official",
  "eligibility",
  "price",
  "payment",
  "privacy",
  "under18",
] as const;

export type CcFaqId = (typeof CC_FAQ_IDS)[number];

export type CcFaqItem = {
  id: CcFaqId;
  /** Message id under CC.landing for the question. */
  questionKey: string;
  /** Message id under CC.landing for the answer. */
  answerKey: string;
  /** Hidden items stay in the data but are not rendered (admin toggle later). */
  hidden?: boolean;
};

export const CC_FAQ: readonly CcFaqItem[] = CC_FAQ_IDS.map((id) => ({
  id,
  questionKey: `faq.items.${id}.q`,
  answerKey: `faq.items.${id}.a`,
}));

/** The items to show, in order. */
export function visibleFaq(items: readonly CcFaqItem[] = CC_FAQ): CcFaqItem[] {
  return items.filter((i) => !i.hidden);
}

export function isCcFaqId(v: unknown): v is CcFaqId {
  return typeof v === "string" && (CC_FAQ_IDS as readonly string[]).includes(v);
}
