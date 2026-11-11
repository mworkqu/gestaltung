import Link from "next/link";
import { ClipboardX, Construction, OctagonAlert } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { ArticleBody } from "@/components/cad-champions/help/article-body";
import { Button, EmptyState } from "@/components/cad-champions/ui";
import type { Locale } from "@/i18n/routing";
import type { CcTestTaskPublic } from "@/lib/cad-champions/db/types";
import { ccPath } from "@/lib/cad-champions/routes";
import { briefFor } from "@/lib/cad-champions/test/view";

// Server-only pieces shared by the test pages and the admin preview.

/** Not found / being set up / load error, with a way back. */
export async function TestLoadProblem({ locale, reason }: { locale: Locale; reason: "not_found" | "not_set_up" | "error" }) {
  const t = await getTranslations({ locale, namespace: "CC.test" });
  const icon = reason === "not_found" ? ClipboardX : reason === "not_set_up" ? Construction : OctagonAlert;
  return (
    <EmptyState
      icon={icon}
      title={t(`problem.${reason}.title`)}
      description={t(`problem.${reason}.body`)}
      action={
        <Button asChild variant="secondary">
          <Link href={ccPath(locale, "/test")}>{t("problem.back")}</Link>
        </Button>
      }
    />
  );
}

/** Each task's brief rendered as markdown (server), keyed by task id. Tasks without a brief are left out. */
export function renderBriefs(tasks: readonly CcTestTaskPublic[], locale: Locale): Record<string, React.ReactNode> {
  const out: Record<string, React.ReactNode> = {};
  for (const task of tasks) {
    const md = briefFor(task, locale);
    if (md) out[task.id] = <ArticleBody markdown={md} locale={locale} hasVideoId={false} />;
  }
  return out;
}
