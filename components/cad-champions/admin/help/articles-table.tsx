"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { deleteHelpArticleAction, setHelpPublishedAction } from "@/app/[locale]/cad-champions/admin/help/actions";
import { Button, ConfirmDialog, StatusChip, useToast } from "@/components/cad-champions/ui";
import type { Locale } from "@/i18n/routing";
import { helpfulStats } from "@/lib/cad-champions/admin/help";
import type { HelpListRow } from "@/lib/cad-champions/admin/help-server";
import { formatDate, formatNumber } from "@/lib/cad-champions/format";
import { normalizeHelpCategory } from "@/lib/cad-champions/help/categories";
import { Ltr } from "@/lib/cad-champions/ltr";
import { ccPath } from "@/lib/cad-champions/routes";

// Articles list: category, slug, titles, published switch, helpful counts,
// % helpful, updated, edit / delete (ConfirmDialog).

export function HelpArticlesTable({ articles }: { articles: HelpListRow[] }) {
  const t = useTranslations("CC.admin.help");
  const tc = useTranslations("CC.admin.common");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [toDelete, setToDelete] = React.useState<HelpListRow | null>(null);

  async function toggle(a: HelpListRow) {
    setBusy(a.id);
    try {
      const res = await setHelpPublishedAction({ id: a.id, published: !a.is_published });
      if (res.ok) {
        toast.success(!a.is_published ? t("list.nowPublished") : t("list.nowDraft"), t("list.visibleNote"));
        router.refresh();
      } else {
        toast.error(res.error === "invalid" ? t("form.needsBody") : tc(`errors.${res.error}`));
      }
    } catch (e) {
      console.error("[cc-admin-help] toggle failed", e);
      toast.error(tc("errors.error"));
    } finally {
      setBusy(null);
    }
  }

  async function confirmDelete() {
    if (!toDelete) return;
    const res = await deleteHelpArticleAction(toDelete.id);
    if (res.ok) {
      toast.success(t("list.deleted", { title: toDelete.title_en }));
      router.refresh();
    } else toast.error(tc(`errors.${res.error}`));
    setToDelete(null);
  }

  return (
    <>
      <div className="neu overflow-x-auto p-0">
        <table className="w-full min-w-[56rem] text-start text-sm">
          <caption className="sr-only">{t("list.caption")}</caption>
          <thead>
            <tr className="border-b border-border text-xs uppercase tracking-wide text-mutedtext rtl:normal-case rtl:tracking-normal">
              <th scope="col" className="p-3 text-start font-semibold">
                {t("list.category")}
              </th>
              <th scope="col" className="p-3 text-start font-semibold">
                {t("list.article")}
              </th>
              <th scope="col" className="p-3 text-start font-semibold">
                {t("list.status")}
              </th>
              <th scope="col" className="p-3 text-end font-semibold">
                {t("list.yes")}
              </th>
              <th scope="col" className="p-3 text-end font-semibold">
                {t("list.no")}
              </th>
              <th scope="col" className="p-3 text-end font-semibold">
                {t("list.percent")}
              </th>
              <th scope="col" className="p-3 text-start font-semibold">
                {t("list.updated")}
              </th>
              <th scope="col" className="p-3 text-start font-semibold">
                <span className="sr-only">{t("list.actions")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {articles.map((a) => {
              const cat = normalizeHelpCategory(a.category);
              const s = helpfulStats(a.helpful_yes, a.helpful_no);
              const title = locale === "ar" ? a.title_ar || a.title_en : a.title_en || a.title_ar;
              return (
                <tr key={a.id} className="border-b border-border last:border-b-0 align-top">
                  <td className="p-3">{cat ? t(`categories.${cat}`) : <Ltr>{a.category}</Ltr>}</td>
                  <td className="p-3">
                    <Link href={ccPath(locale, `/admin/help/${a.id}`)} className="font-semibold text-heading underline-offset-2 hover:underline">
                      {title}
                    </Link>
                    <div className="text-xs text-mutedtext">
                      <Ltr className="font-mono">{a.slug}</Ltr>
                    </div>
                  </td>
                  <td className="p-3">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={a.is_published}
                      aria-label={t(a.is_published ? "list.unpublishNamed" : "list.publishNamed", { name: title })}
                      disabled={busy === a.id}
                      onClick={() => toggle(a)}
                      className="min-h-11 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
                    >
                      <StatusChip tone={a.is_published ? "success" : "neutral"}>{a.is_published ? tc("published") : tc("draft")}</StatusChip>
                    </button>
                  </td>
                  <td className="p-3 text-end">{formatNumber(s.yes, locale)}</td>
                  <td className="p-3 text-end">{formatNumber(s.no, locale)}</td>
                  <td className="p-3 text-end font-semibold">{s.percent === null ? t("list.noVotes") : `${formatNumber(s.percent, locale)}%`}</td>
                  <td className="whitespace-nowrap p-3 text-mutedtext">{formatDate(a.updated_at, locale)}</td>
                  <td className="p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Button asChild variant="secondary" size="sm">
                        <Link href={ccPath(locale, `/admin/help/${a.id}`)}>{tc("edit")}</Link>
                      </Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => setToDelete(a)} aria-label={t("list.deleteNamed", { name: title })}>
                        <Trash2 aria-hidden="true" className="h-4 w-4" />
                        {tc("delete")}
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(o) => (!o ? setToDelete(null) : undefined)}
        title={t("list.deleteTitle", { title: toDelete?.title_en ?? "" })}
        consequence={t("list.deleteConsequence")}
        confirmLabel={tc("delete")}
        cancelLabel={tc("cancel")}
        tone="danger"
        onConfirm={confirmDelete}
      />
    </>
  );
}
