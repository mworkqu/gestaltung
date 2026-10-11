import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";

import { e2eFixturesEnabled } from "@/lib/e2e-fixtures";
import { HeroPosterClient } from "./poster-client";

// TEST-ONLY (lib/e2e-fixtures.ts): the home hero's 3D demo enclosure, still, at
// 640 x 480, so scripts/make-hero-poster.mjs can capture public/home/hero-enclosure.webp
// from the same viewer the live hero uses. 404 everywhere else.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function HeroPosterFixture({ params }: { params: Promise<{ locale: string }> }) {
  if (!e2eFixturesEnabled()) notFound();
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <div className="container py-8">
      <HeroPosterClient />
    </div>
  );
}
