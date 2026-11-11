// JSON-LD for the CAD Champions landing page (pure): Course (provided by an
// EducationalOrganization) and FAQPage. Never mentions WorldSkills.

import type { Locale } from "@/i18n/routing";

export type LandingJsonLdInput = {
  locale: Locale;
  url: string;
  siteUrl: string;
  name: string;
  description: string;
  orgName: string;
  orgDescription: string;
  addressLocality: string;
  addressCountry: string;
  faq: readonly { question: string; answer: string }[];
};

type Json = Record<string, unknown>;

export function buildLandingJsonLd(input: LandingJsonLdInput): Json[] {
  const inLanguage = input.locale === "ar" ? "ar" : "en";
  const org: Json = {
    "@type": "EducationalOrganization",
    "@id": `${input.siteUrl}/#cad-champions-org`,
    name: input.orgName,
    description: input.orgDescription,
    url: input.siteUrl,
    address: {
      "@type": "PostalAddress",
      addressLocality: input.addressLocality,
      addressCountry: input.addressCountry,
    },
  };
  const course: Json = {
    "@context": "https://schema.org",
    "@type": "Course",
    "@id": `${input.url}#course`,
    name: input.name,
    description: input.description,
    url: input.url,
    inLanguage,
    availableLanguage: ["en", "ar"],
    provider: org,
  };
  const faq: Json = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "@id": `${input.url}#faq`,
    inLanguage,
    mainEntity: input.faq
      .filter((f) => f.question.trim() && f.answer.trim())
      .map((f) => ({
        "@type": "Question",
        name: f.question,
        acceptedAnswer: { "@type": "Answer", text: f.answer },
      })),
  };
  return [course, faq];
}

/** Safe text for a <script type="application/ld+json"> body (no "</script>" breakout). */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}
