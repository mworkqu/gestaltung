import Link from "next/link";
import { ChevronDown, Pencil } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { StatusChip } from "@/components/cad-champions/ui";
import type { Locale } from "@/i18n/routing";
import type { HealthGroup, HealthIssue } from "@/lib/cad-champions/admin/health";
import { formatNumber } from "@/lib/cad-champions/format";
import { Ltr } from "@/lib/cad-champions/ltr";
import { ccPath } from "@/lib/cad-champions/routes";

// Content health lists (Prompt 11 Step C): one block per kind of problem,
// each item with a direct edit link. Server component. Long lists (the
// placeholders on public pages) start collapsed; native <details> keeps it
// keyboard friendly.

function IssueRow({ issue, locale }: { issue: HealthIssue; locale: Locale }) {
  const t = useTranslations("CC.admin.health");
  const tc = useTranslations("CC.admin.common");
  const isMessage = issue.entity === "message";
  const field = issue.field ? t(`fields.${issue.field}`) : "";
  let detail: string | null = null;
  if (issue.kind === "missing_text" && issue.side) detail = t(`missing.${issue.side}`, { field });
  else if (issue.kind === "todo_content" && issue.side) detail = t(`placeholderIn.${issue.side}`, { field });
  else if (issue.kind === "todo_message" && issue.side) detail = t(`messagePlaceholder.${issue.side}`);

  return (
    <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-1">
        <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
          <span className="rounded-full border border-border bg-panel px-2 py-0.5 text-xs font-semibold text-body">{t(`entities.${issue.entity}`)}</span>
          {isMessage ? (
            <Ltr className="break-all font-mono text-xs">{issue.title}</Ltr>
          ) : (
            <span dir="auto" className="break-words">
              {issue.title}
            </span>
          )}
          {issue.published !== undefined && issue.entity !== "help" ? <StatusChip tone={issue.published ? "success" : "neutral"}>{issue.published ? t("live") : t("draft")}</StatusChip> : null}
        </p>
        {detail ? <p className="text-sm text-body">{detail}</p> : null}
        {issue.excerpt ? (
          <p dir="auto" className="break-words rounded-lg bg-panel px-2 py-1 text-xs text-mutedtext">
            {issue.excerpt}
          </p>
        ) : null}
      </div>
      <div className="shrink-0">
        {issue.href ? (
          <Link
            href={ccPath(locale, issue.href)}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-white/60 bg-surface px-4 text-sm font-semibold text-ink shadow-neu-sm hover:shadow-neu focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
          >
            <Pencil aria-hidden="true" strokeWidth={1.75} className="h-4 w-4" />
            {isMessage ? t("editMessages") : tc("edit")}
          </Link>
        ) : (
          <p className="max-w-xs text-xs text-mutedtext">{t("noEditor")}</p>
        )}
      </div>
    </li>
  );
}

export function HealthGroups({ groups }: { groups: HealthGroup[] }) {
  const t = useTranslations("CC.admin.health");
  const locale = useLocale() as Locale;
  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <details key={g.kind} open={g.count > 0 && g.kind !== "todo_message"} className="neu group p-5 sm:p-6">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent [&::-webkit-details-marker]:hidden">
            <span className="min-w-0">
              <span className="block title-card">{t(`kinds.${g.kind}.title`)}</span>
              <span className="mt-1 block text-sm text-body">{t(`kinds.${g.kind}.hint`)}</span>
            </span>
            <span className="flex shrink-0 items-center gap-2">
              <StatusChip tone={g.count > 0 ? "warning" : "success"}>{formatNumber(g.count, locale)}</StatusChip>
              <ChevronDown aria-hidden="true" strokeWidth={1.75} className="h-5 w-5 text-mutedtext transition-transform group-open:rotate-180 motion-reduce:transition-none" />
            </span>
          </summary>
          {g.count === 0 ? (
            <p className="mt-3 text-sm text-mutedtext">{t("groupEmpty")}</p>
          ) : (
            <ul className="mt-3 divide-y divide-border">
              {g.issues.map((issue) => (
                <IssueRow key={issue.id} issue={issue} locale={locale} />
              ))}
            </ul>
          )}
        </details>
      ))}
    </div>
  );
}
