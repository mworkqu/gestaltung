import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Boxes, Plus } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { getSessionContext } from "@/lib/auth/get-session";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

type JobRow = {
  id: string;
  title: string;
  method: string;
  status: string;
  quantity: number;
  created_at: string;
  client_tenant_id: string;
};

export default async function JobsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await getSessionContext();
  if (!session) redirect(`/${locale}/sign-in`);

  const t = await getTranslations("Jobs");
  const isRtl = locale === "ar";
  const role = session.profile.role;
  const isSuperAdmin = role === "super_admin";
  const isClient = role === "client";
  const mono = (extra = "") =>
    cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  const supabase = await createClient();
  // RLS scopes rows: client = own, super_admin = all, workshop = none (6a).
  const { data, error } = await supabase
    .from("jobs")
    .select("id, title, method, status, quantity, created_at, client_tenant_id")
    .order("created_at", { ascending: false });
  const jobs = (data ?? []) as JobRow[];

  // Client-tenant names for the super_admin view.
  const tenantNames = new Map<string, string>();
  if (isSuperAdmin && jobs.length > 0) {
    const { data: tdata } = await supabase.from("tenants").select("id, name");
    (tdata ?? []).forEach((x) => tenantNames.set(x.id, x.name));
  }

  const dateFmt = new Intl.DateTimeFormat(locale === "ar" ? "ar-QA" : "en-GB", {
    dateStyle: "medium",
  });

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className={mono("text-[10px] text-azure")}>{t("kicker")}</p>
          <h1 className="mt-2 text-2xl font-extrabold text-heading">
            {t("title")}
          </h1>
          <p className="mt-1 text-sm text-mutedtext">
            {t("count", { count: jobs.length })}
          </p>
        </div>
        {isClient && (
          <Button asChild className="rounded-full">
            <Link href="/dashboard/jobs/new">
              <Plus className="h-4 w-4" />
              {t("newJob")}
            </Link>
          </Button>
        )}
      </div>

      {error && (
        <p className="mt-8 text-sm font-medium text-destructive">
          {t("error_unknown")}
        </p>
      )}

      {!error && jobs.length === 0 && (
        <div className="neu mt-8 flex flex-col items-center gap-4 p-12 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-panel shadow-neu-sm">
            <Boxes className="h-7 w-7 text-cobalt" strokeWidth={1.5} />
          </span>
          <div>
            <p className="text-base font-semibold text-heading">
              {t("emptyTitle")}
            </p>
            <p className="mt-1 text-sm text-mutedtext">
              {isClient ? t("emptyBodyClient") : t("emptyBodyOther")}
            </p>
          </div>
          {isClient && (
            <Button asChild className="rounded-full">
              <Link href="/dashboard/jobs/new">
                <Plus className="h-4 w-4" />
                {t("newJob")}
              </Link>
            </Button>
          )}
        </div>
      )}

      {!error && jobs.length > 0 && (
        <div className="neu mt-8 overflow-x-auto p-2">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-borderstrong/60">
                <Th mono={mono}>{t("colTitle")}</Th>
                <Th mono={mono}>{t("colMethod")}</Th>
                {isSuperAdmin && <Th mono={mono}>{t("colClient")}</Th>}
                <Th mono={mono} numeric>
                  {t("colQuantity")}
                </Th>
                <Th mono={mono}>{t("colStatus")}</Th>
                <Th mono={mono}>{t("colCreated")}</Th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr
                  key={job.id}
                  className="border-b border-borderstrong/40 last:border-0 hover:bg-panel/50"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/dashboard/jobs/${job.id}`}
                      className="font-medium text-heading hover:text-cobalt"
                    >
                      {job.title}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-body">{t(`method_${job.method}`)}</td>
                  {isSuperAdmin && (
                    <td className="px-4 py-3 text-body">
                      {tenantNames.get(job.client_tenant_id) ?? "—"}
                    </td>
                  )}
                  <td className="px-4 py-3 text-end tabular-nums text-body">
                    {job.quantity}
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-cobalt/10 px-2 py-0.5 text-[10px] font-semibold text-cobalt">
                      {t(`status_${job.status}`)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-mutedtext">
                    {dateFmt.format(new Date(job.created_at))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Th({
  children,
  mono,
  numeric,
}: {
  children: React.ReactNode;
  mono: (extra?: string) => string;
  numeric?: boolean;
}) {
  return (
    <th
      className={cn(
        "px-4 py-3 text-[10px] font-semibold text-mutedtext",
        numeric ? "text-end" : "text-start",
        mono()
      )}
    >
      {children}
    </th>
  );
}
