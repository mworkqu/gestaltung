import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowDown, ArrowUp, Download, SearchX, Users, UsersRound } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AdminPagination } from "@/components/cad-champions/admin/pagination";
import { Alert, EmptyState, HelpTip, PageHeader, StatusChip } from "@/components/cad-champions/ui";
import { paginate, parsePage } from "@/lib/admin/pagination";
import { adminDb } from "@/lib/cad-champions/admin/server";
import { CC_BANDS } from "@/lib/cad-champions/db/types";
import { filterStudents, institutionsOf, isEnrolled, parseStudentFilters, studentFilterParams, type StudentFilters, type StudentSort } from "@/lib/cad-champions/admin/students";
import { loadStudentRows } from "@/lib/cad-champions/admin/students-server";
import { requireCcStaff } from "@/lib/cad-champions/auth/server";
import { formatDate, formatNumber } from "@/lib/cad-champions/format";
import { Ltr } from "@/lib/cad-champions/ltr";
import { ccPageMetadata } from "@/lib/cad-champions/metadata";
import { ccPath, isCcLocale } from "@/lib/cad-champions/routes";

// Students table (Prompt 11 Step D). Staff (instructor + admin). Filters,
// sort and page live in the URL (?q&institution&band&enrolled&stuck&flagged
// &sort&dir&page); the admin home links ?flagged=1. CSV export and in-person
// sessions are admin only (the export route re-checks the role).

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

type SP = Record<string, string | string[] | undefined>;
type Props = { params: Promise<{ locale: string }>; searchParams: Promise<SP> };

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isCcLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: "CC.admin.students" });
  return ccPageMetadata({ locale, path: "/admin/students", title: t("title") });
}

const selectCls = "min-h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
const btnCls =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2";

function queryString(p: Record<string, string>): string {
  const s = new URLSearchParams(p).toString();
  return s ? `?${s}` : "";
}

export default async function CcAdminStudentsPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!isCcLocale(locale)) notFound();
  setRequestLocale(locale);
  const cc = await requireCcStaff(locale, ccPath(locale, "/admin/students"));
  const t = await getTranslations({ locale, namespace: "CC.admin.students" });
  const tc = await getTranslations({ locale, namespace: "CC.admin.common" });
  const sp = await searchParams;
  const filters = parseStudentFilters(sp);
  const base = ccPath(locale, "/admin/students");

  const db = adminDb();
  const loaded = db ? await loadStudentRows(db) : ({ ok: false, reason: "error" } as const);
  const now = Date.now();
  const all = loaded.ok ? loaded.rows : [];
  const filtered = filterStudents(all, filters, now);
  const paged = paginate(filtered, parsePage(sp.page), PAGE_SIZE);
  const institutions = institutionsOf(all);
  const filterParams = studentFilterParams(filters);
  const anyFilter = !!(filters.q || filters.institution || filters.band || filters.enrolled || filters.stuck || filters.flagged);

  const sortHref = (key: StudentSort) => {
    const dir: StudentFilters["dir"] = filters.sort === key ? (filters.dir === "asc" ? "desc" : "asc") : key === "name" ? "asc" : "desc";
    return base + queryString(studentFilterParams({ ...filters, sort: key, dir }));
  };
  const SortHead = ({ k, label }: { k: StudentSort; label: string }) => {
    const active = filters.sort === k;
    return (
      <th scope="col" className="px-3 py-2 text-start font-semibold" aria-sort={active ? (filters.dir === "asc" ? "ascending" : "descending") : "none"}>
        <Link href={sortHref(k)} className="inline-flex min-h-11 items-center gap-1 text-ink hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
          {label}
          {active ? (
            filters.dir === "asc" ? (
              <ArrowUp aria-hidden="true" className="h-3.5 w-3.5" />
            ) : (
              <ArrowDown aria-hidden="true" className="h-3.5 w-3.5" />
            )
          ) : null}
          <span className="sr-only">{t("sortBy", { column: label })}</span>
        </Link>
      </th>
    );
  };

  const actions = cc.isAdmin ? (
    <div className="flex flex-wrap gap-2">
      <a href={ccPath(locale, "/admin/students/export") + queryString(filterParams)} className={`${btnCls} bg-surface text-ink shadow-neu-sm`} download>
        <Download aria-hidden="true" className="h-4 w-4" />
        {t("exportCsv")}
      </a>
      <Link href={ccPath(locale, "/admin/students/in-person")} className={`${btnCls} bg-accent text-accent-foreground shadow-neu-sm`}>
        <UsersRound aria-hidden="true" className="h-4 w-4" />
        {t("inPersonLink")}
      </Link>
    </div>
  ) : undefined;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        purpose={t("purpose")}
        help={
          <HelpTip label={t("helpLabel")}>
            {t("help")}
            {cc.isAdmin ? ` ${t("helpCsv")}` : ""}
          </HelpTip>
        }
        actions={actions}
      />

      <form method="get" action={base} className="neu grid grid-cols-1 gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4" aria-label={tc("filters")}>
        <label className="flex flex-col gap-1 text-sm font-semibold text-ink sm:col-span-2">
          {tc("search")}
          <input type="search" name="q" defaultValue={filters.q} placeholder={t("searchPlaceholder")} className={selectCls} maxLength={100} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold text-ink">
          {t("filters.institution")}
          <select name="institution" defaultValue={filters.institution} className={selectCls}>
            <option value="">{tc("all")}</option>
            {institutions.map((i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold text-ink">
          {t("filters.band")}
          <select name="band" defaultValue={filters.band} className={selectCls}>
            <option value="">{tc("all")}</option>
            {CC_BANDS.map((b) => (
              <option key={b} value={b}>
                {t(`bands.${b}`)}
              </option>
            ))}
            <option value="none">{t("filters.noResult")}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold text-ink">
          {t("filters.enrolled")}
          <select name="enrolled" defaultValue={filters.enrolled} className={selectCls}>
            <option value="">{tc("all")}</option>
            <option value="yes">{tc("yes")}</option>
            <option value="no">{tc("no")}</option>
          </select>
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm text-ink">
          <input type="checkbox" name="stuck" value="1" defaultChecked={filters.stuck} className="h-5 w-5 accent-[var(--accent,#0e59c5)]" />
          {t("filters.stuck")}
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm text-ink">
          <input type="checkbox" name="flagged" value="1" defaultChecked={filters.flagged} className="h-5 w-5 accent-[var(--accent,#0e59c5)]" />
          {t("filters.flagged")}
        </label>
        {filters.sort !== "created" ? <input type="hidden" name="sort" value={filters.sort} /> : null}
        {filters.dir !== "desc" ? <input type="hidden" name="dir" value={filters.dir} /> : null}
        <div className="flex flex-wrap items-end gap-2">
          <button type="submit" className={`${btnCls} bg-accent text-accent-foreground shadow-neu-sm`}>
            {tc("apply")}
          </button>
          {anyFilter ? (
            <Link href={base} className={`${btnCls} text-accent hover:bg-panel`}>
              {tc("clear")}
            </Link>
          ) : null}
        </div>
      </form>

      {!loaded.ok ? (
        <Alert tone={loaded.reason === "not_set_up" ? "info" : "error"} title={loaded.reason === "not_set_up" ? tc("notSetUp.title") : t("loadError.title")}>
          {loaded.reason === "not_set_up" ? tc("notSetUp.body") : t("loadError.body")}
        </Alert>
      ) : all.length === 0 ? (
        <EmptyState icon={Users} title={t("empty.title")} description={t("empty.body")} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title={t("noMatch.title")}
          description={t("noMatch.body")}
          action={
            <Link href={base} className={`${btnCls} bg-surface text-accent shadow-neu-sm`}>
              {tc("clear")}
            </Link>
          }
        />
      ) : (
        <section className="neu space-y-4 p-4 sm:p-5" aria-label={t("tableLabel")}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[60rem] border-collapse text-sm">
              <thead className="border-b border-border text-xs text-mutedtext">
                <tr>
                  <SortHead k="name" label={t("cols.name")} />
                  <th scope="col" className="px-3 py-2 text-start font-semibold">
                    {t("cols.institution")}
                  </th>
                  <th scope="col" className="px-3 py-2 text-start font-semibold">
                    {t("cols.studyLevel")}
                  </th>
                  <th scope="col" className="px-3 py-2 text-start font-semibold">
                    {t("cols.minor")}
                  </th>
                  <SortHead k="get_ready" label={t("cols.getReady")} />
                  <SortHead k="score" label={t("cols.latest")} />
                  <th scope="col" className="px-3 py-2 text-start font-semibold">
                    {t("cols.band")}
                  </th>
                  <th scope="col" className="px-3 py-2 text-start font-semibold">
                    {t("cols.enrollment")}
                  </th>
                  <SortHead k="last_active" label={t("cols.lastActive")} />
                </tr>
              </thead>
              <tbody>
                {paged.items.map((r) => (
                  <tr key={r.id} className="border-b border-border/60 align-top last:border-0">
                    <td className="px-3 py-2">
                      <Link href={ccPath(locale, `/admin/students/${r.id}`)} className="font-semibold text-accent underline-offset-2 hover:underline">
                        {(locale === "ar" ? r.nameAr || r.name : r.name || r.nameAr) || t("noName")}
                      </Link>
                      {r.email ? (
                        <Ltr as="p" className="text-xs text-mutedtext">
                          {r.email}
                        </Ltr>
                      ) : null}
                      <div className="mt-1 flex flex-wrap gap-1">
                        {r.openFlags > 0 ? (
                          <StatusChip tone="danger">{t("openFlags", { count: formatNumber(r.openFlags, locale) })}</StatusChip>
                        ) : null}
                        {r.deletionRequested ? <StatusChip tone="warning">{t("deletionRequested")}</StatusChip> : null}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-body">{r.institution ?? "-"}</td>
                    <td className="px-3 py-2 text-body">{r.studyLevel ? t(`studyLevels.${r.studyLevel}`) : "-"}</td>
                    <td className="px-3 py-2">{r.isMinor ? <StatusChip tone="warning">{t("minor")}</StatusChip> : <span className="text-mutedtext">{tc("no")}</span>}</td>
                    <td className="px-3 py-2 tabular-nums text-body">
                      <Ltr>{formatNumber(r.getReadyPercent, locale)}%</Ltr>
                      {r.getReadyBypass ? <span className="block text-xs text-mutedtext">{t("bypassed")}</span> : null}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-body">{r.latestPercent == null ? "-" : <Ltr>{`${formatNumber(Math.round(r.latestPercent), locale)}%`}</Ltr>}</td>
                    <td className="px-3 py-2 text-body">{r.latestBand ? t(`bands.${r.latestBand}`) : "-"}</td>
                    <td className="px-3 py-2 text-body">
                      {r.enrolledUntil && isEnrolled(r, now) ? t("enrolledUntil", { date: formatDate(r.enrolledUntil, locale) }) : <span className="text-mutedtext">{t("notEnrolled")}</span>}
                    </td>
                    <td className="px-3 py-2 text-body">{r.lastActiveAt ? formatDate(r.lastActiveAt, locale) : <span className="text-mutedtext">{t("never")}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <AdminPagination locale={locale} basePath={base} params={sp} page={paged.page} pages={paged.pages} total={paged.total} />
        </section>
      )}
    </div>
  );
}
