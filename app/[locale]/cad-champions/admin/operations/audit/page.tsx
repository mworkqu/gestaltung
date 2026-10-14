import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ScrollText } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AdminPagination } from "@/components/cad-champions/admin/pagination";
import { OpsTabs } from "@/components/cad-champions/admin/operations/ops-tabs";
import { Alert, EmptyState, HelpTip, PageHeader } from "@/components/cad-champions/ui";
import {
  AUDIT_ACTION_PREFIXES,
  AUDIT_ENTITY_TYPES,
  AUDIT_PAGE_SIZE,
  auditFilterParams,
  diffAudit,
  pageCount,
  parseAuditFilters,
  prettyJson,
} from "@/lib/cad-champions/admin/audit-view";
import { loadAuditPage, loadStaffOptions, type AuditRow } from "@/lib/cad-champions/admin/audit-view-server";
import { adminDb } from "@/lib/cad-champions/admin/server";
import { requireCcAdmin } from "@/lib/cad-champions/auth/server";
import { formatDateTime } from "@/lib/cad-champions/format";
import { Ltr } from "@/lib/cad-champions/ltr";
import { ccPageMetadata } from "@/lib/cad-champions/metadata";
import { ccPath, isCcLocale } from "@/lib/cad-champions/routes";

// Audit log viewer (Prompt 11 Step F). Admin only. Server-side filters and
// paging (50 rows a page): action prefix, entity type, actor, Qatar date range.

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isCcLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: "CC.admin.operations" });
  return ccPageMetadata({ locale, path: "/admin/operations/audit", title: t("audit.title") });
}

const fieldCls = "min-h-11 w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
const labelCls = "flex flex-col gap-1 text-sm font-semibold text-ink";

export default async function CcAdminAuditPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!isCcLocale(locale)) notFound();
  setRequestLocale(locale);
  await requireCcAdmin(locale, ccPath(locale, "/admin/operations/audit"));
  const t = await getTranslations({ locale, namespace: "CC.admin.operations.audit" });
  const tc = await getTranslations({ locale, namespace: "CC.admin.common" });
  const sp = await searchParams;
  const f = parseAuditFilters(sp);

  const db = adminDb();
  const [loaded, staff] = db ? await Promise.all([loadAuditPage(db, f), loadStaffOptions(db)]) : [null, []];
  const filtered = Object.keys(auditFilterParams(f)).length > 0;
  const basePath = ccPath(locale, "/admin/operations/audit");

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} purpose={t("purpose")} help={<HelpTip label={t("title")}>{t("help")}</HelpTip>} />
      <OpsTabs locale={locale} active="audit" />

      <form method="get" className="neu grid grid-cols-1 gap-4 p-5 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
        <label className={labelCls}>
          {t("filters.action")}
          <input name="action" defaultValue={f.action} list="audit-actions" placeholder="payment." className={fieldCls} dir="ltr" maxLength={60} />
          <datalist id="audit-actions">
            {AUDIT_ACTION_PREFIXES.map((a) => (
              <option key={a} value={a} />
            ))}
          </datalist>
          <span className="text-xs font-normal text-mutedtext">{t("filters.actionHint")}</span>
        </label>
        <label className={labelCls}>
          {t("filters.entity")}
          <input name="entity" defaultValue={f.entity} list="audit-entities" className={fieldCls} dir="ltr" maxLength={60} />
          <datalist id="audit-entities">
            {AUDIT_ENTITY_TYPES.map((a) => (
              <option key={a} value={a} />
            ))}
          </datalist>
        </label>
        <label className={labelCls}>
          {t("filters.actor")}
          <select name="actor" defaultValue={f.actor} className={fieldCls}>
            <option value="">{t("filters.actorAny")}</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className={labelCls}>
          {t("filters.from")}
          <input type="date" name="from" defaultValue={f.from} className={fieldCls} />
        </label>
        <label className={labelCls}>
          {t("filters.to")}
          <input type="date" name="to" defaultValue={f.to} className={fieldCls} />
        </label>
        <div className="flex flex-wrap gap-3 sm:col-span-2 lg:col-span-5">
          <button type="submit" className="inline-flex min-h-11 items-center justify-center rounded-full bg-accent px-6 text-sm font-semibold text-accent-foreground shadow-neu-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2">
            {tc("apply")}
          </button>
          {filtered ? (
            <Link href={basePath} className="inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold text-accent hover:bg-panel focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
              {tc("clear")}
            </Link>
          ) : null}
        </div>
      </form>

      {!db ? (
        <Alert tone="error" title={tc("errors.unavailable")} />
      ) : !loaded || !loaded.ok ? (
        <Alert tone={loaded && loaded.reason === "not_set_up" ? "info" : "error"} title={tc(`errors.${loaded && loaded.reason === "not_set_up" ? "not_set_up" : "error"}`)} />
      ) : loaded.rows.length === 0 ? (
        <EmptyState icon={ScrollText} title={t("empty.title")} description={filtered ? t("empty.filtered") : t("empty.body")} />
      ) : (
        <>
          <div className="neu-inset overflow-x-auto p-1">
            <table className="w-full min-w-[56rem] border-separate border-spacing-0 text-start text-sm">
              <caption className="sr-only">{t("title")}</caption>
              <thead>
                <tr className="text-xs uppercase tracking-wide text-mutedtext rtl:normal-case rtl:tracking-normal">
                  {(["when", "who", "action", "entity", "changes"] as const).map((c) => (
                    <th key={c} scope="col" className="px-3 py-2 text-start font-semibold">
                      {t(`cols.${c}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loaded.rows.map((r) => (
                  <AuditLine key={r.id} row={r} locale={locale} t={t} />
                ))}
              </tbody>
            </table>
          </div>
          <AdminPagination locale={locale} basePath={basePath} params={sp} page={Math.min(f.page, pageCount(loaded.total, AUDIT_PAGE_SIZE))} pages={pageCount(loaded.total, AUDIT_PAGE_SIZE)} total={loaded.total} />
        </>
      )}
    </div>
  );
}

type T = Awaited<ReturnType<typeof getTranslations>>;

function AuditLine({ row, locale, t }: { row: AuditRow; locale: "en" | "ar"; t: T }) {
  const diff = diffAudit(row.before, row.after);
  const who = row.actorName || row.actorEmail || (row.actorId ? row.actorId.slice(0, 8) : null);
  return (
    <tr className="border-t border-border align-top">
      <td className="whitespace-nowrap px-3 py-3 text-body">{formatDateTime(row.createdAt, locale)}</td>
      <td className="px-3 py-3">
        {who ? (
          <>
            <p className="font-semibold text-ink">{row.actorName || row.actorEmail || <Ltr>{who}</Ltr>}</p>
            {row.actorName && row.actorEmail ? (
              <p className="text-xs text-mutedtext">
                <Ltr>{row.actorEmail}</Ltr>
              </p>
            ) : null}
          </>
        ) : (
          <span className="text-mutedtext">{t("system")}</span>
        )}
      </td>
      <td className="px-3 py-3">
        <Ltr as="code" className="rounded bg-panel px-1.5 py-0.5 text-xs text-ink">
          {row.action}
        </Ltr>
      </td>
      <td className="px-3 py-3">
        <Ltr as="p" className="text-xs text-ink">
          {row.entityType}
        </Ltr>
        {row.entityId ? (
          <Ltr as="p" className="break-all text-xs text-mutedtext">
            {row.entityId}
          </Ltr>
        ) : null}
      </td>
      <td className="min-w-[18rem] px-3 py-3">
        {diff && diff.length > 0 ? (
          <ul className="space-y-1">
            {diff.map((d) => (
              <li key={d.key} className="text-xs">
                <Ltr className="font-mono font-semibold text-ink">{d.key}</Ltr>: <Ltr className="break-words text-[#a1231f] line-through">{d.before ?? t("missing")}</Ltr> <span aria-hidden="true">→</span> <span className="sr-only">{t("after")}</span>
                <Ltr className="break-words text-buy">{d.after ?? t("missing")}</Ltr>
              </li>
            ))}
          </ul>
        ) : diff ? (
          <p className="text-xs text-mutedtext">{t("noChanges")}</p>
        ) : (
          <div className="space-y-2">
            {row.before != null ? <JsonBlock label={t("before")} value={row.before} /> : null}
            {row.after != null ? <JsonBlock label={t("after")} value={row.after} /> : null}
          </div>
        )}
        {(row.before != null || row.after != null) && diff ? (
          <details className="mt-2">
            <summary className="min-h-11 cursor-pointer py-2 text-xs font-semibold text-accent">{t("raw")}</summary>
            <div className="space-y-2">
              {row.before != null ? <JsonBlock label={t("before")} value={row.before} /> : null}
              {row.after != null ? <JsonBlock label={t("after")} value={row.after} /> : null}
            </div>
          </details>
        ) : null}
      </td>
    </tr>
  );
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <p className="text-xs font-semibold text-mutedtext">{label}</p>
      <pre dir="ltr" className="max-h-48 overflow-auto rounded-lg bg-panel p-2 text-start text-xs text-ink">
        {prettyJson(value)}
      </pre>
    </div>
  );
}
