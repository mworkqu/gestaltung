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

// DEFAULT contact number only (owner, 2026-10-03). The live number is the
// store_settings.contact_phone row the owner edits in Dashboard → Settings →
// Contact info; read it through lib/contact-phone(-server).ts, never from here.
// These two constants stay as the fallback when no row exists.
export const COMPANY_WHATSAPP = {
  display: "+974 3366 4265",
  url: "https://wa.me/97433664265",
} as const;

// Same number as the WhatsApp line (default; see above).
export const COMPANY_PHONE = {
  display: "+974 3366 4265",
  tel: "tel:+97433664265",
} as const;

// Registered office (owner, 2026-10-03). Opening hours were not provided, so
// none are shown anywhere.
export const COMPANY_ADDRESS = {
  en: "Rafal Tower, Lusail, Qatar",
  ar: "برج رافال، لوسيل، قطر",
} as const;

export const PAYMENT_METHODS = ["cash_on_delivery", "fawran", "bank_transfer"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const isPaymentMethod = (v: unknown): v is PaymentMethod =>
  typeof v === "string" && (PAYMENT_METHODS as readonly string[]).includes(v);
