import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";

import { MessagesScope } from "@/components/i18n/messages-scope";
import { StudioFixture } from "@/components/studio/StudioFixture";
import { e2eFixturesEnabled } from "@/lib/e2e-fixtures";

// TEST-ONLY (lib/e2e-fixtures.ts): the Design Studio with a mock StudioApi
// (canned answers through our real rules), no Supabase, no session, no write.
// 404 everywhere else.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function StudioFixturePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!e2eFixturesEnabled()) notFound();
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  // ?preset=plant starts on the Enclosure step with a wired plant idea (read here, so server and client agree).
  const preset = sp.preset === "plant" ? "plant" : null;
  // P5-16: ?product=1 turns on the product pipeline (mock endpoints in the worker); ?idea=<key> one of
  // the five acceptance ideas (plant_waterer, desk_lamp, cat_feeder, doorbell, tv_remote); ?admin=1 Engineer view.
  const ideas = ["plant_waterer", "desk_lamp", "cat_feeder", "doorbell", "tv_remote"] as const;
  const idea = ideas.find((k) => k === sp.idea) ?? null;
  return (
    <MessagesScope scope="studio">
      <div className="container max-w-5xl py-5 sm:py-8">
        <StudioFixture
          stored={sp.store === "1"}
          step={str(sp.step)}
          preset={preset}
          product={sp.product === "1"}
          idea={idea}
          admin={sp.admin === "1"}
        />
      </div>
    </MessagesScope>
  );
}
