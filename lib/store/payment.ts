// Payment calculation (owner, 2026-09-28): payment-ready with no gateway yet.
// Pure: turns what a project used and needs into priced lines and the amount
// actually due — 0 while charging is off ("free during launch").

export type PaymentInput = {
  aiCalls: number;
  perCallQar: number;
  /** Parts the client would buy now (BOM "To buy now"). */
  partsQar: number;
  charging: boolean;
};

export type PaymentLine = { key: "ai" | "parts"; qty?: number; unitQar?: number; amountQar: number };

export type PaymentSummary = {
  lines: PaymentLine[];
  totalQar: number;
  /** What the client pays now: the total when charging is on, else 0. */
  dueQar: number;
  /** The AI part waived while charging is off. */
  waivedQar: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export function paymentSummary(i: PaymentInput): PaymentSummary {
  const calls = Math.max(0, Math.trunc(i.aiCalls) || 0);
  const per = Math.max(0, Number(i.perCallQar) || 0);
  const ai = round2(calls * per);
  const parts = round2(Math.max(0, Number(i.partsQar) || 0));
  const total = round2(ai + parts);
  return {
    lines: [
      { key: "ai", qty: calls, unitQar: per, amountQar: ai },
      { key: "parts", amountQar: parts },
    ],
    totalQar: total,
    // Parts are paid when ordered (checkout); AI generations are what's free during launch.
    dueQar: i.charging ? ai : 0,
    waivedQar: i.charging ? 0 : ai,
  };
}
