import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { getSessionContext } from "@/lib/auth/get-session";
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

  const t = await getTranslations("Dashboard");
  const isRtl = locale === "ar";
  const mono = (extra = "") =>
    cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  const { email, profile, tenant } = session;

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
      <p className={mono("text-[10px] text-azure")}>{t("kicker")}</p>
      <h1 className="mt-3 text-2xl font-extrabold text-heading">
        {profile.full_name
          ? t("welcomeNamed", { name: profile.full_name })
          : t("welcome")}
      </h1>

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

      <p className="mt-6 text-sm leading-relaxed text-body">{t("note")}</p>
    </div>
  );
}
