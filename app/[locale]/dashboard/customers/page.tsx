import { getTranslations, setRequestLocale } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { leadMatchesCustomer, totalPaidQar, type LeadLike } from "@/lib/admin/customer-export";
import { formatPhoneDisplay, toWhatsAppDigits } from "@/lib/phone";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { cn } from "@/lib/utils";
import { needsMigration, qarFormatter } from "../ai-costs/format";
import { requireSuperAdmin } from "@/lib/auth/guards";
import { intlTag, asLocale } from "@/lib/locale";
import { dayFormatter, timeFormatter } from "@/lib/format/date";

// Every customer in one place (owner, 2026-10-19: "allow me to see all
// customer data"). One row per profiles row — who they are, how to reach them
// on WhatsApp, when they joined and last signed in, and how much of our data
// they sit on. Click a row for every table that holds their data.
//
// Reads go through RLS as the signed-in super_admin; only the sign-up and
// last-sign-in timestamps need the service key (auth.users), and the page
// works without it. A section we cannot read is named instead of crashing.

export const dynamic = "force-dynamic";

type ProfileRow = {
  id: string;
  role: string | null;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  locale: string | null;
  created_at: string | null;
};

type AiRpcRow = { user_id: string; calls: number | string; last_call: string | null };

type Customer = {
  id: string;
  email: string | null;
  name: string | null;
  role: string | null;
  phone: string | null;
  locale: string | null;
  joined: string | null;
  lastSignIn: string | null;
  anonymous: boolean;
  projects: number;
  orders: number;
  leads: number;
  aiCalls: number;
  paid: number;
  lastActive: string | null;
};

export default async function CustomersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { locale } = await params;
  await requireSuperAdmin(locale);
  const { q } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("Customers");
  const isRtl = locale === "ar";
  const mono = (extra = "") => cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);
  const loc = intlTag(asLocale(locale));
  const num = new Intl.NumberFormat(loc);
  const qar = qarFormatter(locale);
  const dayFmt = dayFormatter(asLocale(locale));
  const timeFmt = timeFormatter(asLocale(locale));
  const query = (typeof q === "string" ? q : "").trim().slice(0, 80);

  const supabase = await createClient();
  const [profRes, projRes, orderRes, leadRes, payRes, aiRes] = await Promise.all([
    supabase.from("profiles").select("id, role, full_name, phone, email, locale, created_at").limit(5000),
    supabase.from("projects").select("id, user_id, created_at, updated_at").limit(20000),
    supabase.from("part_orders").select("profile_id, status, total_qar, created_at, updated_at").limit(20000),
    supabase.from("inquiries").select("id, email, phone, project_id, created_at").order("created_at", { ascending: false }).limit(4000),
    supabase.from("payments").select("user_id, status, amount_qar, created_at").limit(20000),
    supabase.rpc("admin_ai_cost_users", { p_query: null }),
  ]);

  // Sections we could not read: named under the table rather than crashing.
  const unavailable = (
    [
      [t("secProjects"), projRes.error],
      [t("secOrders"), orderRes.error],
      [t("secLeads"), leadRes.error],
      [t("secPayments"), payRes.error],
      [t("secAi"), aiRes.error],
    ] as const
  )
    .filter(([, e]) => !!e)
    .map(([label, e]) => `${label}${needsMigration(e) ? ` (${t("migrationPending")})` : ""}`);

  if (profRes.error) {
    return (
      <div className="space-y-6">
        <Header kicker={t("kicker")} title={t("title")} intro={t("intro")} mono={mono} />
        <p className="text-sm font-medium text-destructive">{needsMigration(profRes.error) ? t("needsMigration") : t("loadError")}</p>
      </div>
    );
  }

  const profiles = (profRes.data ?? []) as ProfileRow[];

  // Sign-up and last-sign-in live in auth.users; only the service key reads them.
  const service = createServiceClient();
  const authById = new Map<string, { email: string | null; joined: string | null; lastSignIn: string | null; anonymous: boolean }>();
  if (service) {
    for (let page = 1; page <= 10; page++) {
      const { data, error } = await service.auth.admin.listUsers({ page, perPage: 1000 });
      const users = data?.users ?? [];
      if (error || users.length === 0) break;
      for (const u of users)
        authById.set(u.id, {
          email: u.email ?? null,
          joined: u.created_at ?? null,
          lastSignIn: u.last_sign_in_at ?? null,
          anonymous: Boolean((u as { is_anonymous?: boolean }).is_anonymous),
        });
      if (users.length < 1000) break;
    }
  }

  const projects = (projRes.data ?? []) as { id: string; user_id: string | null; created_at: string | null; updated_at: string | null }[];
  const orders = (orderRes.data ?? []) as { profile_id: string | null; status: string | null; total_qar: number | string | null; created_at: string | null; updated_at: string | null }[];
  const payments = (payRes.data ?? []) as { user_id: string | null; status: string | null; amount_qar: number | string | null; created_at: string | null }[];
  const leads = (leadRes.data ?? []) as (LeadLike & { id: string; created_at: string | null })[];

  const groupBy = <T,>(items: T[], key: (item: T) => string | null | undefined) => {
    const out = new Map<string, T[]>();
    for (const item of items) {
      const k = key(item);
      if (!k) continue;
      const bucket = out.get(k);
      if (bucket) bucket.push(item);
      else out.set(k, [item]);
    }
    return out;
  };
  const projectsBy = groupBy(projects, (p) => p.user_id);
  const ordersBy = groupBy(orders, (o) => o.profile_id);
  const paymentsBy = groupBy(payments, (p) => p.user_id);
  // ai_usage is rolled up per user and model by admin_ai_cost_users (0088).
  const aiBy = new Map<string, { calls: number; last: string | null }>();
  for (const r of (aiRes.error ? [] : ((aiRes.data ?? []) as AiRpcRow[]))) {
    const a = aiBy.get(r.user_id) ?? { calls: 0, last: null };
    a.calls += Number(r.calls ?? 0);
    if (r.last_call && (!a.last || r.last_call > a.last)) a.last = r.last_call;
    aiBy.set(r.user_id, a);
  }

  const customers: Customer[] = profiles.map((p) => {
    const auth = authById.get(p.id);
    const mine = projectsBy.get(p.id) ?? [];
    const myOrders = ordersBy.get(p.id) ?? [];
    const myPayments = paymentsBy.get(p.id) ?? [];
    const ai = aiBy.get(p.id);
    const identity = { email: auth?.email ?? p.email, phone: p.phone, projectIds: mine.map((x) => x.id) };
    const myLeads = leads.filter((l) => leadMatchesCustomer(l, identity));
    const stamps = [
      p.created_at,
      auth?.lastSignIn ?? null,
      ...mine.map((x) => x.updated_at ?? x.created_at),
      ...myOrders.map((x) => x.updated_at ?? x.created_at),
      ...myPayments.map((x) => x.created_at),
      ...myLeads.map((x) => x.created_at),
      ai?.last ?? null,
    ].filter((s): s is string => !!s);
    return {
      id: p.id,
      email: auth?.email ?? p.email,
      name: p.full_name,
      role: p.role,
      phone: p.phone,
      locale: p.locale,
      joined: auth?.joined ?? p.created_at,
      lastSignIn: auth?.lastSignIn ?? null,
      anonymous: auth?.anonymous ?? false,
      projects: mine.length,
      orders: myOrders.length,
      leads: myLeads.length,
      aiCalls: ai?.calls ?? 0,
      paid: totalPaidQar({ payments: myPayments, orders: myOrders }),
      lastActive: stamps.sort().pop() ?? null,
    };
  });

  const needle = query.toLowerCase();
  const bareNeedle = needle.replace(/\D/g, "");
  const rows = customers
    .filter(
      (c) =>
        !needle ||
        (c.email ?? "").toLowerCase().includes(needle) ||
        (c.name ?? "").toLowerCase().includes(needle) ||
        c.id.toLowerCase().includes(needle) ||
        (!!bareNeedle && (c.phone ?? "").replace(/\D/g, "").includes(bareNeedle))
    )
    .sort((a, b) => (b.lastActive ?? "").localeCompare(a.lastActive ?? ""));

  const stats: { label: string; value: string }[] = [
    { label: t("customers"), value: num.format(rows.length) },
    { label: t("withProjects"), value: num.format(rows.filter((c) => c.projects > 0).length) },
    { label: t("withOrders"), value: num.format(rows.filter((c) => c.orders > 0).length) },
    { label: t("withLeads"), value: num.format(rows.filter((c) => c.leads > 0).length) },
    { label: t("totalPaid"), value: qar(rows.reduce((s, c) => s + c.paid, 0)) },
  ];

  const th = "pb-2 font-medium";
  const tdn = "py-2 text-end font-mono tabular-nums";

  return (
    <div className="space-y-8">
      <Header kicker={t("kicker")} title={t("title")} intro={t("intro")} mono={mono} />

      <form method="get" className="neu flex flex-wrap items-center gap-3 p-4">
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder={t("searchPlaceholder")}
          className="min-w-[220px] flex-1 rounded-xl bg-panel px-3 py-2 text-sm text-heading shadow-neu-inset outline-none"
        />
        <button type="submit" className="rounded-xl bg-panel px-4 py-2 text-sm font-semibold text-heading shadow-neu-sm">
          {t("search")}
        </button>
        {query && (
          <Link href="/dashboard/customers" className="text-[12px] text-mutedtext underline">
            {t("clear")}
          </Link>
        )}
      </form>

      <section className="neu p-6">
        <dl className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
          {stats.map((s) => (
            <div key={s.label}>
              <dt className="text-[10px] uppercase tracking-wider text-faint">{s.label}</dt>
              <dd className="font-mono text-lg font-bold tabular-nums text-heading">{s.value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-[12px] text-mutedtext">{t("paidNote")}</p>
        <p className="mt-1 text-[12px] text-mutedtext">{t("leadsNote")}</p>
        {!service && <p className="mt-1 text-[12px] text-mutedtext">{t("noServiceKey")}</p>}
      </section>

      <section className="neu space-y-3 p-6">
        <h2 className="text-base font-bold text-heading">{t("listTitle")}</h2>
        {unavailable.length > 0 && <p className="text-[12px] text-destructive">{t("unavailable", { sections: unavailable.join(" · ") })}</p>}
        {rows.length === 0 ? (
          <p className="text-sm text-mutedtext">{query ? t("noMatches") : t("noCustomers")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1180px] text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-faint">
                  <th className={cn(th, "text-start")}>{t("colCustomer")}</th>
                  <th className={cn(th, "text-start")}>{t("colRole")}</th>
                  <th className={cn(th, "text-start")}>{t("colLocale")}</th>
                  <th className={cn(th, "text-start")}>{t("colJoined")}</th>
                  <th className={cn(th, "text-start")}>{t("colLastSignIn")}</th>
                  <th className={cn(th, "text-end")}>{t("colProjects")}</th>
                  <th className={cn(th, "text-end")}>{t("colOrders")}</th>
                  <th className={cn(th, "text-end")}>{t("colLeads")}</th>
                  <th className={cn(th, "text-end")}>{t("colAiCalls")}</th>
                  <th className={cn(th, "text-end")}>{t("colPaid")}</th>
                  <th className={cn(th, "text-end")}>{t("colLastActive")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-borderstrong/40">
                {rows.map((c) => (
                  <tr key={c.id} className="align-top">
                    <td className="py-2 text-heading">
                      <Link href={`/dashboard/customers/${c.id}`} className="font-medium underline-offset-2 hover:underline" dir="ltr">
                        {c.email ?? (c.anonymous ? `${t("guest")} ${c.id.slice(0, 8)}` : (c.name ?? c.id.slice(0, 8)))}
                      </Link>
                      {c.name && <span className="block text-[11.5px] text-mutedtext">{c.name}</span>}
                      {c.phone &&
                        (toWhatsAppDigits(c.phone) ? (
                          <a
                            href={`https://wa.me/${toWhatsAppDigits(c.phone)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block text-[11.5px] font-medium text-cobalt hover:underline"
                            dir="ltr"
                          >
                            {formatPhoneDisplay(c.phone)}
                          </a>
                        ) : (
                          <span className="block text-[11.5px] text-mutedtext" dir="ltr">
                            {formatPhoneDisplay(c.phone)}
                          </span>
                        ))}
                      <span className="block font-mono text-[10px] text-faint">{c.id.slice(0, 8)}</span>
                    </td>
                    <td className="py-2 text-[12px] text-body">{c.role ?? "—"}</td>
                    <td className="py-2 font-mono text-[12px] text-body" dir="ltr">{c.locale ?? "—"}</td>
                    <td className="py-2 text-[12px] text-mutedtext">{c.joined ? dayFmt.format(new Date(c.joined)) : "—"}</td>
                    <td className="py-2 text-[12px] text-mutedtext">{c.lastSignIn ? timeFmt.format(new Date(c.lastSignIn)) : "—"}</td>
                    <td className={tdn}>{num.format(c.projects)}</td>
                    <td className={tdn}>{num.format(c.orders)}</td>
                    <td className={tdn}>{num.format(c.leads)}</td>
                    <td className={tdn}>{num.format(c.aiCalls)}</td>
                    <td className={cn(tdn, "font-semibold text-heading")}>{c.paid > 0 ? qar(c.paid) : "—"}</td>
                    <td className="py-2 text-end text-[12px] text-mutedtext">{c.lastActive ? timeFmt.format(new Date(c.lastActive)) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Header({ kicker, title, intro, mono }: { kicker: string; title: string; intro: string; mono: (extra?: string) => string }) {
  return (
    <div>
      <p className={mono("text-[10px] text-azure")}>{kicker}</p>
      <h1 className="mt-2 text-2xl font-extrabold text-heading">{title}</h1>
      <p className="mt-1 max-w-[70ch] text-sm text-mutedtext">{intro}</p>
    </div>
  );
}
