import { notFound, redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { ProductPicture } from "@/components/projects/product-picture";
import { RequestReceived } from "@/components/studio/RequestReceived";
import { signInHref } from "@/lib/auth/next-path";
import { pageMetadata } from "@/lib/seo";
import { studioLibrary } from "@/lib/studio/library/remote";
import { requestSummary } from "@/lib/studio/request-summary";
import { loadDoc } from "@/lib/studio/server/doc";
import { projectPreviewUrl } from "@/lib/studio/server/preview-url";
import { getProjectQuote, getQuoteRule, linkedPrices } from "@/lib/studio/server/quote";
import { createClient } from "@/lib/supabase/server";
import { asLocale } from "@/lib/locale";
import { UUID_RE } from "@/lib/uuid";

// W2 (2026-10-11): where "Get it made" lands. "Request received", the project
// in plain words (name, case picture, parts, printed parts), a rough price
// range labelled "estimate" and the WhatsApp promise. Private: the project's
// owner (or a super_admin) only — read with the visitor's own session under
// RLS, plus an explicit owner check; anyone else gets a 404. No 3D here.
// W2b: the range comes from the same quoteBreakdown() the lead stores, with
// the owner's rule (store_settings.studio_quote_rule); once the owner saved a
// quote in the admin, "Your quote: QAR X" (+ note) replaces the range.

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "StudioRequest" });
  return pageMetadata({ locale, path: "/projects", title: t("metaTitle"), noindex: true });
}

export default async function ProjectRequestPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  if (!UUID_RE.test(id)) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(signInHref(locale, `/${locale}/projects/${id}/request`));

  const [{ data: project }, { data: me }] = await Promise.all([
    supabase.from("projects").select("id, name, user_id").eq("id", id).maybeSingle(),
    supabase.from("profiles").select("role").eq("id", user.id).maybeSingle(),
  ]);
  const row = project as { id: string; name: string | null; user_id: string | null } | null;
  const isAdmin = (me as { role?: string } | null)?.role === "super_admin";
  if (!row || (row.user_id !== user.id && !isAdmin)) notFound();

  const [loaded, lib, rule, ownerQuote, pictureUrl, tp] = await Promise.all([
    loadDoc(supabase, id),
    studioLibrary().catch(() => null),
    getQuoteRule(supabase, id),
    getProjectQuote(supabase, id),
    projectPreviewUrl(supabase, id),
    getTranslations({ locale, namespace: "StudioPreview" }),
  ]);
  const doc = loaded.ok && loaded.available ? loaded.doc : null;
  const getPart = (pid: string) => lib?.getPart(pid);
  // Store prices of the linked parts (published, not merged), read under RLS.
  const priceBySku = await linkedPrices(supabase, doc, getPart).catch(() => new Map<string, number>());

  const summary = requestSummary({
    doc,
    projectName: row.name ?? "",
    getPart,
    locale: asLocale(locale),
    prices: priceBySku,
    rule: rule.rule,
  });

  return (
    <div className="container max-w-4xl py-6 sm:py-10">
      {pictureUrl && (
        <div className="mb-4 flex justify-center sm:justify-start" data-testid="chosen-design-picture">
          <ProductPicture url={pictureUrl} alt={tp("altNamed", { name: row.name || "" })} size={160} />
        </div>
      )}
      <RequestReceived summary={summary} locale={locale} designHref={`/projects/${id}/studio?step=make`} ownerQuote={ownerQuote} />
    </div>
  );
}
