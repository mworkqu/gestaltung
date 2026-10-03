import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth/get-session";
import { AdminOverview } from "@/components/dashboard/admin-overview";
import { cn } from "@/lib/utils";

// Auth state is per-request (read from cookies); never statically cache it.
export const dynamic = "force-dynamic";

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  // The layout already gates auth; this is belt-and-suspenders + gives us the
  // session for the profile/tenant read below.
  const session = await getSessionContext();
  if (!session) {
    redirect(`/${locale}/sign-in`);
  }

  // super_admin gets the global command center; everyone else the account view.
  if (session.profile.role === "super_admin") {
    return <AdminOverview locale={locale} />;
  }

  const t = await getTranslations("Dashboard");
  const isRtl = locale === "ar";
  const mono = (extra = "") =>
    cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  const { email, profile, tenant } = session;

  const heading = (
    <>
      <p className={mono("text-[10px] text-azure")}>{t("kicker")}</p>
      <h1 className="mt-3 text-2xl font-extrabold text-heading">
        {profile.full_name
          ? t("welcomeNamed", { name: profile.full_name })
          : t("welcome")}
      </h1>
    </>
  );

  // Customers: their orders and projects. Role and tenant are internal details,
  // so only workshop users see them (below).
  if (profile.role === "client") {
    // Counts only, through the request-scoped client so RLS applies. Orders
    // are matched on profile_id, projects on user_id.
    const supabase = await createClient();
    const [orders, projects] = await Promise.all([
      supabase
        .from("part_orders")
        .select("id", { count: "exact", head: true })
        .eq("profile_id", profile.id),
      supabase
        .from("projects")
        .select("id", { count: "exact", head: true })
        .eq("user_id", profile.id),
    ]);
    const orderCount = orders.count ?? 0;
    const projectCount = projects.count ?? 0;

    const blocks = [
      {
        key: "orders",
        title: t("myOrders"),
        count: t("ordersCount", { count: orderCount }),
        empty: orderCount === 0,
        emptyCopy: t("ordersEmpty"),
        href: "/store",
        linkLabel: orderCount === 0 ? t("ordersEmptyLink") : t("ordersLink"),
      },
      {
        key: "projects",
        title: t("myProjects"),
        count: t("projectsCount", { count: projectCount }),
        empty: projectCount === 0,
        emptyCopy: t("projectsEmpty"),
        href: projectCount === 0 ? "/projects/new" : "/projects",
        linkLabel: projectCount === 0 ? t("projectsEmptyLink") : t("projectsLink"),
      },
    ];

    return (
      <div className="mx-auto max-w-2xl">
        {heading}

        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          {blocks.map((b) => (
            <section key={b.key} className="neu flex flex-col gap-3 p-6">
              <h2 className={mono("text-[10px] text-mutedtext")}>{b.title}</h2>
              {b.empty ? (
                <p className="text-sm leading-relaxed text-body">{b.emptyCopy}</p>
              ) : (
                <p className="text-2xl font-extrabold text-heading">{b.count}</p>
              )}
              <Link
                href={b.href}
                className="mt-auto pt-2 text-sm font-semibold text-azure transition-colors hover:text-cobalt-hover"
              >
                {b.linkLabel}
              </Link>
            </section>
          ))}
        </div>
      </div>
    );
  }

  // Workshop users keep the account / tenant summary.
  const roleLabel = t(`role_${profile.role}`);
  const tenantText = tenant
    ? `${tenant.name} · ${t(`tenantType_${tenant.type}`)}`
    : t("noTenant");

  const rows: { label: string; value: string }[] = [
    { label: t("emailLabel"), value: email },
    { label: t("phoneLabel"), value: profile.phone || t("noPhone") },
    { label: t("roleLabel"), value: roleLabel },
    { label: t("tenantLabel"), value: tenantText },
  ];

  return (
    <div className="mx-auto max-w-2xl">
      {heading}

      <div className="neu mt-8 divide-y divide-borderstrong/60 p-2">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-center justify-between gap-4 px-4 py-4"
          >
            <span className={mono("text-[10px] text-mutedtext")}>
              {row.label}
            </span>
            <span className="text-sm font-medium text-heading">{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
