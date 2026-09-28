// The registered company, from the Commercial Registration printed 2026-02-09
// (Ministry of Commerce and Industry, Qatar), and the payment details the
// owner gave on 2026-09-29. Only public business facts — never the owner's
// personal ID numbers.
export const COMPANY = {
  crNumber: "236988",
  legalNameEn: "Gestaltung for Trading and Services W.L.L",
  legalNameAr: "جستالتونج للتجارة والخدمات ذ.م.م",
  country: "Qatar",
} as const;

export const PAYMENT_DETAILS = {
  bank: "Qatar International Islamic Bank (QIIB)",
  accountName: "GESTALTUNG FOR TRD AND SERV",
  iban: "QA94 QIIB 0000 0000 1112 2207 6400 1",
  fawranAlias: "CR-236988",
} as const;

export const PAYMENT_METHODS = ["cash_on_delivery", "fawran", "bank_transfer"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const isPaymentMethod = (v: unknown): v is PaymentMethod =>
  typeof v === "string" && (PAYMENT_METHODS as readonly string[]).includes(v);
