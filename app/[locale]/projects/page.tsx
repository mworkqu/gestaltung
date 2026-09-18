import { getTranslations, setRequestLocale } from "next-intl/server";
import { Plus } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { ProjectList } from "@/components/projects/project-list";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Projects" });
  return { title: t("metaTitle"), description: t("metaDescription") };
}

// Public. A visitor can land here with no account at all and start building.
export default async function ProjectsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("Projects");
  const isRtl = locale === "ar";
  const mono = (extra = "") =>
    cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  return (
    <div className="container space-y-8 py-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <p className={mono("text-[10px] text-azure")}>{t("kicker")}</p>
          <h1 className="text-3xl font-extrabold tracking-tight text-heading sm:text-4xl">
            {t("listHeading")}
          </h1>
          <p className="max-w-xl text-base leading-relaxed text-body">{t("listIntro")}</p>
        </div>
        <Button asChild size="lg">
          <Link href="/projects/new">
            <Plus className="me-2 h-4 w-4" />
            {t("newProject")}
          </Link>
        </Button>
      </header>

      <ProjectList />
    </div>
  );
}
