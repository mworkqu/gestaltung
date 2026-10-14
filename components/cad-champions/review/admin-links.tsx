import Link from "next/link";
import { ClipboardCheck, MessageCircleQuestion } from "lucide-react";
import { getTranslations } from "next-intl/server";

import type { Locale } from "@/i18n/routing";
import { ccPath } from "@/lib/cad-champions/routes";

// Links from the admin page (still a placeholder until Prompt 11) to the
// trainer review queue and the questions inbox (Prompt 8).
export async function AdminReviewLinks({ locale }: { locale: Locale }) {
  const t = await getTranslations({ locale, namespace: "CC.review.adminHome" });
  const cards = [
    { href: ccPath(locale, "/admin/review"), icon: ClipboardCheck, title: t("reviewTitle"), text: t("reviewText"), cta: t("reviewCta") },
    { href: ccPath(locale, "/admin/questions"), icon: MessageCircleQuestion, title: t("questionsTitle"), text: t("questionsText"), cta: t("questionsCta") },
  ];
  return (
    <nav aria-label={t("navLabel")} className="container pb-12">
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {cards.map((c) => (
          <li key={c.href} className="neu flex flex-col gap-3 p-6">
            <c.icon aria-hidden="true" strokeWidth={1.75} className="h-6 w-6 text-accent" />
            <h2 className="text-lg font-extrabold text-heading">{c.title}</h2>
            <p className="text-sm text-body">{c.text}</p>
            <Link
              href={c.href}
              className="mt-auto inline-flex min-h-11 w-fit items-center rounded-full bg-accent px-5 text-sm font-semibold text-accent-foreground shadow-neu-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
            >
              {c.cta}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
