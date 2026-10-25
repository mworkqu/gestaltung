import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { aiUsageByModel, leadMatchesCustomer, totalPaidQar, type AiUsageLike, type LeadLike } from "@/lib/admin/customer-export";
import { loadCustomerBundle, type CustomerSection } from "@/lib/admin/customer-data";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { cn } from "@/lib/utils";
import { needsMigration, qarFormatter, usdFormatter } from "../../ai-costs/format";
import { requireSuperAdmin } from "@/lib/auth/guards";
import { intlTag, asLocale } from "@/lib/locale";
import { UUID_RE } from "@/lib/uuid";
import { dayFormatter, timeFormatter } from "@/lib/format/date";
import type { CustomerFmt } from "./panel";
import { ProfileSection, type CustomerAuth } from "./sections/profile";
import { ProjectsSection } from "./sections/projects";
import { OrdersSection } from "./sections/orders";
import { ItemsSection } from "./sections/items";
import { LeadsSection } from "./sections/leads";
import { LedgerSection } from "./sections/ledger";
import { PaymentsSection } from "./sections/payments";
import { PassSection } from "./sections/pass";
import { SessionsSection } from "./sections/sessions";
import { AiSection } from "./sections/ai";
import { JobsSection } from "./sections/jobs";
import { CadSection } from "./sections/cad";
import { SignalsSection } from "./sections/signals";
import { OutboxSection } from "./sections/outbox";

// One customer, every table that holds their data (owner, 2026-10-19). Each
// section is read on its own: a table we cannot read says so, an empty one
// says "none" rather than disappearing, so the owner can see that there is
// nothing rather than wonder whether the page forgot it.
//
// The reads are lib/admin/customer-data.ts (shared with the JSON export); each
// Panel is a component under ./sections. cart_items is absent on purpose — it
// has no super_admin policy (0016).

export const dynamic = "force-dynamic";

export default async function CustomerPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  await requireSuperAdmin(locale);
  if (!UUID_RE.test(id)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations("Customers");
  const isRtl = locale === "ar";
  const mono = (extra = "") => cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);
  const loc = intlTag(asLocale(locale));
  const num = new Intl.NumberFormat(loc);
  const qar = qarFormatter(locale);
  const usd = usdFormatter(locale);
  const dayFmt = dayFormatter(asLocale(locale));
  const timeFmt = timeFormatter(asLocale(locale));
  const day = (v: unknown) => (typeof v === "string" && v ? dayFmt.format(new Date(v)) : "—");
  const time = (v: unknown) => (typeof v === "string" && v ? timeFmt.format(new Date(v)) : "—");
  const text = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));
  const count = (v: unknown) => num.format(Number(v ?? 0));
  const money = (v: unknown) => (v === null || v === undefined ? "—" : qar(Number(v)));
  const yesNo = (v: unknown) => (v ? "✓" : "—");
  const clip = (v: unknown, n = 90) => {
    const s = v === null || v === undefined ? "" : String(v);
    return s.length > n ? `${s.slice(0, n)}…` : s || "—";
  };
  const f: CustomerFmt = { t, num, usd, day, time, text, count, money, yesNo, clip };

  // Every read is soft: a section that fails is named, the rest still renders.
  const failed = new Map<CustomerSection, string>();
  const why = (key: CustomerSection) => failed.get(key);

  const supabase = await createClient();
  const { profile, projects, orders, leadRows, ledger, payments, pass, sessions, usage, jobs, cad, signals, outbox, items } =
    await loadCustomerBundle(supabase, id, {
      onError: (key, error) => failed.set(key, needsMigration(error) ? t("migrationPending") : t("sectionError")),
      // Only the columns the tables below show.
      columns: {
        projects: "id, name, status, stage, is_test, created_at, updated_at",
        orders: "id, status, total_qar, shipping_qar, discount_qar, payment_method, delivery_area, is_test, created_at, updated_at",
        usage: "model, prompt_tokens, completion_tokens, total_tokens, audio_seconds, cost_usd, outcome, created_at",
      },
    });

  // Sign-up / last sign-in live in auth.users; only the service key reads them.
  const service = createServiceClient();
  let auth: CustomerAuth | null = null;
  if (service) {
    const { data } = await service.auth.admin.getUserById(id);
    if (data?.user)
      auth = {
        email: data.user.email ?? null,
        anonymous: Boolean((data.user as { is_anonymous?: boolean }).is_anonymous),
        joined: data.user.created_at ?? null,
        lastSignIn: data.user.last_sign_in_at ?? null,
        confirmed: data.user.email_confirmed_at ?? null,
        provider: (data.user.app_metadata as { provider?: string } | null)?.provider ?? null,
      };
  }

  if (!profile && !projects?.length && !orders?.length && !payments?.length && !auth) notFound();

  const email = auth?.email ?? (profile?.email as string | null) ?? null;
  const phone = (profile?.phone as string | null) ?? null;
  const fullName = (profile?.full_name as string | null) ?? null;
  const leads = (leadRows ?? []).filter((l) => leadMatchesCustomer(l as LeadLike, { email, phone, projectIds: (projects ?? []).map((p) => String(p.id)) }));
  const byModel = aiUsageByModel((usage ?? []) as AiUsageLike[]);
  const paid = totalPaidQar({
    payments: (payments ?? []) as { amount_qar?: number | string | null; status?: string | null }[],
    orders: (orders ?? []) as { total_qar?: number | string | null; status?: string | null }[],
  });
  const title = email ?? fullName ?? (auth?.anonymous ? `${t("guest")} ${id.slice(0, 8)}` : id.slice(0, 8));
  const exportUrl = `/api/admin/customers/${id}/export`;

  const stats: { label: string; value: string }[] = [
    { label: t("colProjects"), value: count(projects?.length) },
    { label: t("colOrders"), value: count(orders?.length) },
    { label: t("colLeads"), value: count(leads.length) },
    { label: t("colAiCalls"), value: count(byModel.reduce((s, m) => s + m.calls, 0)) },
    { label: t("aiCost"), value: usd(byModel.reduce((s, m) => s + m.costUsd, 0)) },
    { label: t("colPaid"), value: qar(paid) },
  ];

  return (
    <div className="space-y-8">
      <div>
        <Link href="/dashboard/customers" className="text-[12px] text-mutedtext underline-offset-2 hover:underline">
          {t("back")}
        </Link>
        <p className={mono("mt-3 text-[10px] text-azure")}>{t("kicker")}</p>
        <h1 className="mt-2 text-2xl font-extrabold text-heading">
          <span dir="ltr">{title}</span>
        </h1>
        <p className="mt-1 text-sm text-mutedtext">{[fullName, auth?.anonymous ? t("guest") : null, id].filter(Boolean).join(" · ")}</p>
        <p className="mt-3 flex flex-wrap items-center gap-3 text-[12px]">
          <a href={`${exportUrl}?download=1`} className="font-semibold text-cobalt hover:underline">
            {t("download")}
          </a>
          <a href={exportUrl} target="_blank" rel="noopener noreferrer" className="text-mutedtext underline-offset-2 hover:underline">
            {t("viewJson")}
          </a>
          <Link href={`/dashboard/ai-costs/${id}`} className="text-mutedtext underline-offset-2 hover:underline">
            {t("openAiCosts")}
          </Link>
        </p>
      </div>

      <section className="neu p-6">
        <dl className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
          {stats.map((s) => (
            <div key={s.label}>
              <dt className="text-[10px] uppercase tracking-wider text-faint">{s.label}</dt>
              <dd className="font-mono text-lg font-bold tabular-nums text-heading">{s.value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-[12px] text-mutedtext">{t("paidNote")}</p>
        {!service && <p className="mt-1 text-[12px] text-mutedtext">{t("noServiceKey")}</p>}
      </section>
      <ProfileSection
        profile={profile}
        auth={auth}
        email={email}
        fullName={fullName}
        phone={phone}
        id={id}
        unavailable={why("profile")}
        f={f}
      />
      <ProjectsSection projects={projects} unavailable={why("projects")} f={f} />
      <OrdersSection orders={orders} unavailable={why("orders")} f={f} />
      <ItemsSection items={items} unavailable={why("items")} f={f} />
      <LeadsSection leads={leads} unavailable={why("leads")} f={f} />
      <LedgerSection ledger={ledger} unavailable={why("ledger")} f={f} />
      <PaymentsSection payments={payments} unavailable={why("payments")} f={f} />
      <PassSection pass={pass} unavailable={why("pass")} f={f} />
      <SessionsSection sessions={sessions} unavailable={why("sessions")} f={f} />
      <AiSection byModel={byModel} unavailable={why("usage")} f={f} />
      <JobsSection jobs={jobs} unavailable={why("jobs")} f={f} />
      <CadSection cad={cad} unavailable={why("cad")} f={f} />
      <SignalsSection signals={signals} unavailable={why("signals")} f={f} />
      <OutboxSection outbox={outbox} unavailable={why("outbox")} f={f} />
    </div>
  );
}
