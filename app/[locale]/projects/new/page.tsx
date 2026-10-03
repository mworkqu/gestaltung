import { getTranslations, setRequestLocale } from "next-intl/server";
import { pageMetadata } from "@/lib/seo";
import { ArrowRight } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { NewProjectForm } from "@/components/projects/new-project-form";
import { cn } from "@/lib/utils";
import { MessagesScope } from "@/components/i18n/messages-scope";

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ for?: string }>;
}) {
  const { locale } = await params;
  const forDrawing = (await searchParams).for === "drawing";
  const t = await getTranslations({ locale, namespace: "Projects" });
  return pageMetadata({
    locale,
    path: "/projects/new",
    title: forDrawing ? t("drawingPageTitle") : t("newPageTitle"),
    description: forDrawing ? t("drawingIntro") : t("metaDescription"),
  });
}

// No sign-in wall. The anonymous session is created by the form, on submit.
// `?for=drawing` is the drawing-request variant: "drawing request" wording,
// and of the three explanation lines only "why your number" applies.
export default async function NewProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ for?: string }>;
}) {
  const { locale } = await params;
  const forDrawing = (await searchParams).for === "drawing";
  setRequestLocale(locale);

  const t = await getTranslations("Projects");
  const isRtl = locale === "ar";
  const mono = (extra = "") =>
    cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  const explain = forDrawing ? ["explainWhy"] : ["explainNext", "explainFree", "explainWhy"];

  return (
    <MessagesScope scope="projects">
    <div className="container max-w-xl space-y-6 py-12">
      <header className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <p className={mono("text-[10px] text-azure")}>{t("kicker")}</p>
          <Link
            href="/projects"
            className="inline-flex items-center gap-1 text-sm font-medium text-cobalt hover:underline"
          >
            {t("myProjectsLink")}
            <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden />
          </Link>
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight text-heading">
          {forDrawing ? t("drawingHeading") : t("newHeading")}
        </h1>
        <p className="text-base leading-relaxed text-body">{forDrawing ? t("drawingIntro") : t("newIntro")}</p>
      </header>

      <ul className="space-y-2 text-sm leading-relaxed text-body">
        {explain.map((k) => (
          <li key={k} className="flex gap-2">
            <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-cobalt" />
            <span>{t(k)}</span>
          </li>
        ))}
      </ul>

      <NewProjectForm forDrawing={forDrawing} />
    </div>
    </MessagesScope>
  );
}
