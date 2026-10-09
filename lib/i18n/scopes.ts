// Which next-intl messages each route sends to the browser (Phase G).
//
// Server components read messages on the server and need nothing in the page
// payload; only CLIENT components ("use client" files and everything they
// import) need their namespaces passed through a NextIntlClientProvider.
// Before Phase G the locale layout passed the whole messages file (2,400+ keys,
// 160–270 KB of inline script per page). Now:
//
//   - app/[locale]/layout.tsx passes BASE: what the site chrome's client
//     components use (header nav, cart badge, credit badge, language switcher,
//     cookie notice). Entries may be single keys ("Parts.cartAria").
//   - A page or route layout whose client components need more wraps its
//     output in <MessagesScope scope="..."> (components/i18n/messages-scope.tsx)
//     with one of the scopes below. A nested provider REPLACES the outer one, so
//     a scope lists every namespace its client components use, even ones BASE
//     also has. "all" passes the whole file (private, complex areas).
//   - Pages whose client components use no messages need no wrapper.
//
// Adding a client component that calls useTranslations("X"): add "X" to the
// scope of every route that renders it (or to BASE if it is in the site
// chrome). lib/i18n/scopes.test.ts walks the import graph of every page and
// layout and fails when a namespace or key is missing.

export const BASE_MESSAGES = [
  "Nav",
  "Auth.signOut",
  "CookieNotice",
  "LanguageSwitcher",
  "Parts.cartAria",
  "Credits.badge",
  "Credits.badgeAdmin",
  "Credits.badgeTitle",
] as const;

export const MESSAGE_SCOPES = {
  // YourWork + Orders: the signed-in "Your work" strip on the v2 home (P3-05).
  home: ["Delivery", "Hero", "Orders", "Parts", "Phone", "StoreLanding", "Turnstile", "YourWork"],
  store: ["Delivery", "Parts", "Turnstile"],
  product: ["Delivery", "Parts", "Turnstile"],
  cart: ["Cart", "Delivery", "Parts"],
  checkout: ["Checkout", "Credits", "Delivery", "Parts", "PayMethods", "Phone"],
  checkoutSuccess: ["Checkout", "Delivery", "PayMethods"],
  contact: ["Contact", "Phone", "Turnstile"],
  designQuote: ["DesignQuote", "Phone", "Turnstile"],
  // /pricing#credits: only the signed-in balance (CreditsOverview) is a client component.
  pricing: [
    "Credits.overviewSignIn",
    "Credits.signInCta",
    "Credits.overviewAdmin",
    "Credits.kind_wiring",
    "Credits.kind_cad",
    "Credits.overviewRedeemable",
    "Credits.overviewExpiry",
  ],
  auth: ["Auth", "Turnstile"],
  projects: ["Projects", "Turnstile"],
  // /orders/[id]: only PaymentInstructions is a client component; the rest of
  // the Orders namespace is read on the server.
  orders: ["PayMethods"],
  project: ["PartsDashboard", "ProjectCad", "Projects", "Prototyping", "Search", "Turnstile"],
} as const satisfies Record<string, readonly string[]>;

export type MessageScope = keyof typeof MESSAGE_SCOPES | "all";
