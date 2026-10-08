import { getTranslations } from "next-intl/server";
import { ArrowRight } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { MessagesScope } from "@/components/i18n/messages-scope";
import { NewProjectChat } from "@/components/projects/new-project-chat";
import { cn } from "@/lib/utils";

// Server part of the "Describe your idea" screen on /projects/new (P1-11 /
// CC-1). Its own file so it can give the chat the "project" message scope
// (Projects + Prototyping) while the drawing-request form on the same route
// keeps the smaller "projects" scope. The page calls setRequestLocale first.
export async function DescribeIdea({ locale, destination }: { locale: string; destination: string }) {
  const t = await getTranslations("Projects");
  const isRtl = locale === "ar";
  const mono = (extra = "") => cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  return (
    <MessagesScope scope="project">
      <div className="container max-w-xl space-y-6 py-12">
        <header className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <p className={mono("text-[10px] text-azure")}>{t("kicker")}</p>
            <Link
              href="/projects"
              className="inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-cobalt hover:underline sm:min-h-0"
            >
              {t("myProjectsLink")}
              <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden />
            </Link>
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-heading">{t("describeHeading")}</h1>
          <p className="text-base leading-relaxed text-body">{t("describeSub")}</p>
        </header>

        <NewProjectChat destination={destination} />
      </div>
    </MessagesScope>
  );
}
