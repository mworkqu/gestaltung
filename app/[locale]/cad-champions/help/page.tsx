import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { Alert, Card, PageHeader } from "@/components/cad-champions/ui";
import { HelpSearch } from "@/components/cad-champions/help/help-search";
import { SignedInExtras } from "@/components/cad-champions/shell/signed-in-extras";
import { placeholderMetadata } from "@/components/cad-champions/shell/placeholder-page";
import { HELP_CATEGORIES } from "@/lib/cad-champions/help/categories";
import { listHelpArticles, type HelpArticleLink } from "@/lib/cad-champions/help/search";
import { ccPath, isCcLocale } from "@/lib/cad-champions/routes";
import { getCcContact } from "@/lib/cad-champions/site-contact";
import { cn } from "@/lib/utils";

export const generateMetadata = placeholderMetadata("help", "/help");

// Prerendered (ISR). The search query (?q=) is read in the browser by
// HelpSearch; admin edits revalidate this path (admin/help/actions.ts).
export const revalidate = 3600;

type Props = {
  params: Promise<{ locale: string }>;
};

const ring =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface";

export default async function CcHelpPage({ params }: Props) {
  const { locale } = await params;
  if (!isCcLocale(locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: "CC.help" });
  const tp = await getTranslations({ locale, namespace: "CC.pages" });

  const [list, contact] = await Promise.all([listHelpArticles(locale), getCcContact()]);

  const articles: HelpArticleLink[] = list.ok ? list.data : [];
  const byCategory = new Map<string, HelpArticleLink[]>();
  for (const a of articles) {
    if (!a.category) continue;
    byCategory.set(a.category, [...(byCategory.get(a.category) ?? []), a]);
  }

  const categories = (
    <div className="grid gap-5 md:grid-cols-2">
      {HELP_CATEGORIES.map((cat) => {
        const Icon = cat.icon;
        const items = byCategory.get(cat.id) ?? [];
        return (
          <Card as="section" key={cat.id} className="flex flex-col gap-4 p-5 sm:p-6">
            <div className="flex items-start gap-4">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface text-accent shadow-neu-sm">
                <Icon aria-hidden="true" strokeWidth={1.75} className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <h3 className="title-card">{t(cat.titleKey)}</h3>
                <p className="mt-0.5 text-sm text-body">{t(cat.descriptionKey)}</p>
                {list.ok ? (
                  <p className="mt-1 text-xs font-semibold text-mutedtext">{t("articleCount", { count: items.length })}</p>
                ) : null}
              </div>
            </div>
            {list.ok && items.length === 0 ? <p className="text-sm text-mutedtext">{t("emptyCategory")}</p> : null}
            {items.length > 0 ? (
              <ul className="space-y-1">
                {items.map((a) => (
                  <li key={a.slug}>
                    <Link
                      href={ccPath(locale, `/help/${a.slug}`)}
                      className={cn(
                        "flex min-h-[44px] items-center rounded-xl px-3 text-sm font-semibold text-ink hover:bg-panel hover:text-accent",
                        ring
                      )}
                    >
                      {a.title}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>
        );
      })}
    </div>
  );

  return (
    <div className="container space-y-8 py-8 sm:space-y-10 sm:py-12">
      <PageHeader title={tp("help.title")} purpose={tp("help.purpose")} />

      <HelpSearch
        locale={locale}
        pageTitle={tp("help.title")}
        whatsappNumber={contact.whatsappNumber}
        supportEmail={contact.supportEmail}
        categories={categories}
        notice={
          !list.ok ? (
            <Alert tone="info" title={t("setupTitle")}>
              {t("setupBody")}
            </Alert>
          ) : null
        }
      />

      <SignedInExtras pageName={tp("help.title")} />
    </div>
  );
}
