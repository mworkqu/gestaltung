import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { aiUsageByModel, leadMatchesCustomer, totalPaidQar, type AiUsageLike, type LeadLike } from "@/lib/admin/customer-export";
import { formatPhoneDisplay, toWhatsAppDigits } from "@/lib/phone";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { cn } from "@/lib/utils";
import { UUID_RE, needsMigration, qarFormatter, usdFormatter } from "../../ai-costs/format";

// One customer, every table that holds their data (owner, 2026-10-19). Each
// section is read on its own: a table we cannot read says so, an empty one
// says "none" rather than disappearing, so the owner can see that there is
// nothing rather than wonder whether the page forgot it.
//
// cart_items is absent on purpose — it has no super_admin policy (0016).

export const dynamic = "force-dynamic";

type Row = Record<string, unknown>;
type Qerr = { message: string; code?: string } | null;

export default async function CustomerPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  if (!UUID_RE.test(id)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations("Customers");
  const isRtl = locale === "ar";
  const mono = (extra = "") => cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);
  const loc = isRtl ? "ar-QA-u-nu-latn" : "en-GB";
  const num = new Intl.NumberFormat(loc);
  const qar = qarFormatter(locale);
  const usd = usdFormatter(locale);
  const dayFmt = new Intl.DateTimeFormat(loc, { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Qatar" });
  const timeFmt = new Intl.DateTimeFormat(loc, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Qatar" });
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

  // Every read is soft: a section that fails is named, the rest still renders.
  const failed = new Map<string, string>();
  const soft = async <T,>(key: string, q: PromiseLike<{ data: T | null; error: Qerr }>): Promise<T | null> => {
    const { data, error } = await q;
    if (error) {
      failed.set(key, needsMigration(error) ? t("migrationPending") : t("sectionError"));
      return null;
    }
    return data;
  };
  const why = (key: string) => failed.get(key);

  const supabase = await createClient();
  const profile = await soft<Row>("profile", supabase.from("profiles").select("*").eq("id", id).maybeSingle());

  const [projects, orders, leadRows, ledger, payments, pass, sessions, usage, jobs, cad, signals, outbox] = await Promise.all([
    soft<Row[]>(
      "projects",
      supabase.from("projects").select("id, name, status, stage, is_test, created_at, updated_at").eq("user_id", id).order("created_at", { ascending: false })
    ),
    soft<Row[]>(
      "orders",
      supabase
        .from("part_orders")
        .select("id, status, total_qar, shipping_qar, discount_qar, payment_method, delivery_area, is_test, created_at, updated_at")
        .eq("profile_id", id)
        .order("created_at", { ascending: false })
    ),
    soft<Row[]>("leads", supabase.from("inquiries").select("*").order("created_at", { ascending: false }).limit(4000)),
    soft<Row[]>("ledger", supabase.from("credits_ledger").select("*").eq("user_id", id).order("created_at", { ascending: false })),
    soft<Row[]>("payments", supabase.from("payments").select("*").eq("user_id", id).order("created_at", { ascending: false })),
    soft<Row>("pass", supabase.from("idea_passes").select("*").eq("user_id", id).maybeSingle()),
    soft<Row[]>("sessions", supabase.from("idea_sessions").select("*").eq("user_id", id).order("updated_at", { ascending: false })),
    soft<Row[]>(
      "usage",
      supabase
        .from("ai_usage")
        .select("model, prompt_tokens, completion_tokens, total_tokens, audio_seconds, cost_usd, outcome, created_at")
        .eq("user_id", id)
        .order("created_at", { ascending: false })
        .limit(20000)
    ),
    soft<Row[]>("jobs", supabase.from("engineering_jobs").select("*").eq("user_id", id).order("created_at", { ascending: false })),
    soft<Row[]>("cad", supabase.from("cad_generations").select("*").eq("user_id", id).order("created_at", { ascending: false })),
    soft<Row[]>("signals", supabase.from("demand_signals").select("*").eq("user_id", id).order("created_at", { ascending: false })),
    soft<Row[]>("outbox", supabase.from("notification_outbox").select("*").eq("user_id", id).order("created_at", { ascending: false })),
  ]);

  const orderIds = (orders ?? []).map((o) => String(o.id));
  const items = orderIds.length
    ? await soft<Row[]>("items", supabase.from("part_order_items").select("*").in("order_id", orderIds))
    : [];

  // Sign-up / last sign-in live in auth.users; only the service key reads them.
  const service = createServiceClient();
  let auth: { email: string | null; anonymous: boolean; joined: string | null; lastSignIn: string | null; confirmed: string | null; provider: string | null } | null = null;
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

  const profileFields: { label: string; value: React.ReactNode }[] = [
    { label: t("fEmail"), value: <span dir="ltr">{text(email)}</span> },
    { label: t("fName"), value: text(fullName) },
    { label: t("fRole"), value: text(profile?.role) },
    {
      label: t("fPhone"),
      value: phone ? (
        toWhatsAppDigits(phone) ? (
          <a href={`https://wa.me/${toWhatsAppDigits(phone)}`} target="_blank" rel="noopener noreferrer" className="font-medium text-cobalt hover:underline" dir="ltr">
            {formatPhoneDisplay(phone)}
          </a>
        ) : (
          <span dir="ltr">{formatPhoneDisplay(phone)}</span>
        )
      ) : (
        "—"
      ),
    },
    { label: t("fLocale"), value: <span dir="ltr">{text(profile?.locale)}</span> },
    { label: t("fPriceCohort"), value: text(profile?.price_cohort) },
    { label: t("fTenant"), value: <span className="font-mono text-[11px]">{text(profile?.tenant_id)}</span> },
    { label: t("fJoined"), value: time(auth?.joined ?? profile?.created_at) },
    { label: t("fLastSignIn"), value: time(auth?.lastSignIn) },
    { label: t("fConfirmed"), value: time(auth?.confirmed) },
    { label: t("fProvider"), value: <span dir="ltr">{text(auth?.provider)}</span> },
    { label: t("fGuest"), value: yesNo(auth?.anonymous) },
    { label: t("fId"), value: <span className="font-mono text-[11px]" dir="ltr">{id}</span> },
  ];

  const th = "pb-2 font-medium";
  const tdn = "py-2 text-end font-mono tabular-nums";
  const td = "py-2 text-[12px] text-body";
  const tdm = "py-2 font-mono text-[12px] text-body";

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

      {/* Profile */}
      <Panel title={t("secProfile")} unavailable={why("profile")} empty={!profile && !auth} noneLabel={t("noProfile")}>
        {/* no-scroll: Panel wraps every table in overflow-x-auto */}
        <table className="w-full text-sm">
          <tbody className="divide-y divide-borderstrong/40">
            {profileFields.map((f) => (
              <tr key={f.label}>
                <th scope="row" className="w-[42%] py-2 text-start text-[10px] font-medium uppercase tracking-wider text-faint">
                  {f.label}
                </th>
                <td className="py-2 text-[12.5px] text-heading">{f.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      {/* Projects */}
      <Panel title={t("secProjects")} unavailable={why("projects")} empty={!projects?.length} noneLabel={t("noneProjects")}>
        {/* no-scroll: Panel wraps every table in overflow-x-auto */}
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-faint">
              <th className={cn(th, "text-start")}>{t("cProject")}</th>
              <th className={cn(th, "text-start")}>{t("cStatus")}</th>
              <th className={cn(th, "text-start")}>{t("cStage")}</th>
              <th className={cn(th, "text-start")}>{t("cTest")}</th>
              <th className={cn(th, "text-start")}>{t("cCreated")}</th>
              <th className={cn(th, "text-start")}>{t("cUpdated")}</th>
              <th className={cn(th, "text-end")}>{t("cExport")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-borderstrong/40">
            {(projects ?? []).map((p) => (
              <tr key={String(p.id)}>
                <td className="py-2 text-heading">
                  {text(p.name) === "—" ? t("untitled") : String(p.name)}
                  <span className="block font-mono text-[10px] text-faint">{String(p.id).slice(0, 8)}</span>
                </td>
                <td className={td}>{text(p.status)}</td>
                <td className={td}>{text(p.stage)}</td>
                <td className={td}>{yesNo(p.is_test)}</td>
                <td className={td}>{day(p.created_at)}</td>
                <td className={td}>{time(p.updated_at)}</td>
                <td className="py-2 text-end text-[12px]">
                  <a href={`/api/admin/projects/${String(p.id)}/export?download=1`} className="font-medium text-cobalt hover:underline">
                    {t("download")}
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      {/* Part orders */}
      <Panel title={t("secOrders")} unavailable={why("orders")} empty={!orders?.length} noneLabel={t("noneOrders")}>
        {/* no-scroll: Panel wraps every table in overflow-x-auto */}
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-faint">
              <th className={cn(th, "text-start")}>{t("cOrder")}</th>
              <th className={cn(th, "text-start")}>{t("cStatus")}</th>
              <th className={cn(th, "text-start")}>{t("cArea")}</th>
              <th className={cn(th, "text-start")}>{t("cMethod")}</th>
              <th className={cn(th, "text-start")}>{t("cTest")}</th>
              <th className={cn(th, "text-end")}>{t("cShipping")}</th>
              <th className={cn(th, "text-end")}>{t("cDiscount")}</th>
              <th className={cn(th, "text-end")}>{t("cTotal")}</th>
              <th className={cn(th, "text-end")}>{t("cCreated")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-borderstrong/40">
            {(orders ?? []).map((o) => (
              <tr key={String(o.id)}>
                <td className="py-2 text-heading">
                  <Link href={`/dashboard/store/orders/${String(o.id)}`} className="font-mono text-[11.5px] underline-offset-2 hover:underline" dir="ltr">
                    {String(o.id).slice(0, 8)}
                  </Link>
                </td>
                <td className={td}>{text(o.status)}</td>
                <td className={td}>{text(o.delivery_area)}</td>
                <td className={td}>{text(o.payment_method)}</td>
                <td className={td}>{yesNo(o.is_test)}</td>
                <td className={tdn}>{money(o.shipping_qar)}</td>
                <td className={tdn}>{money(o.discount_qar)}</td>
                <td className={cn(tdn, "font-semibold text-heading")}>{money(o.total_qar)}</td>
                <td className="py-2 text-end text-[12px] text-mutedtext">{time(o.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      {/* Order items */}
      <Panel title={t("secItems")} unavailable={why("items")} empty={!items?.length} noneLabel={t("noneItems")}>
        {/* no-scroll: Panel wraps every table in overflow-x-auto */}
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-faint">
              <th className={cn(th, "text-start")}>{t("cOrder")}</th>
              <th className={cn(th, "text-start")}>{t("cSku")}</th>
              <th className={cn(th, "text-start")}>{t("cPart")}</th>
              <th className={cn(th, "text-start")}>{t("cProject")}</th>
              <th className={cn(th, "text-end")}>{t("cQty")}</th>
              <th className={cn(th, "text-end")}>{t("cUnitPrice")}</th>
              <th className={cn(th, "text-end")}>{t("cLineTotal")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-borderstrong/40">
            {(items ?? []).map((i) => (
              <tr key={String(i.id)}>
                <td className={tdm} dir="ltr">{String(i.order_id ?? "").slice(0, 8) || "—"}</td>
                <td className={tdm} dir="ltr">{text(i.part_sku)}</td>
                <td className="py-2 text-[12.5px] text-heading">{text(i.part_name)}</td>
                <td className={tdm} dir="ltr">{i.project_id ? String(i.project_id).slice(0, 8) : "—"}</td>
                <td className={tdn}>{count(i.quantity)}</td>
                <td className={tdn}>{money(i.unit_price_qar)}</td>
                <td className={cn(tdn, "font-semibold text-heading")}>{money(i.line_total_qar)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      {/* Leads / inquiries */}
      <Panel title={t("secLeads")} unavailable={why("leads")} empty={!leads.length} noneLabel={t("noneLeads")}>
        {/* no-scroll: Panel wraps every table in overflow-x-auto */}
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-faint">
              <th className={cn(th, "text-start")}>{t("cCreated")}</th>
              <th className={cn(th, "text-start")}>{t("cName")}</th>
              <th className={cn(th, "text-start")}>{t("cPhone")}</th>
              <th className={cn(th, "text-start")}>{t("cEmail")}</th>
              <th className={cn(th, "text-start")}>{t("cMessage")}</th>
              <th className={cn(th, "text-start")}>{t("cStatus")}</th>
              <th className={cn(th, "text-start")}>{t("cProject")}</th>
              <th className={cn(th, "text-end")}>{t("cQuote")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-borderstrong/40">
            {leads.map((l) => (
              <tr key={String(l.id)} className="align-top">
                <td className="py-2 text-[12px] text-mutedtext">{time(l.created_at)}</td>
                <td className="py-2 text-[12.5px] text-heading">{text(l.name)}</td>
                <td className={tdm} dir="ltr">
                  {l.phone && toWhatsAppDigits(String(l.phone)) ? (
                    <a href={`https://wa.me/${toWhatsAppDigits(String(l.phone))}`} target="_blank" rel="noopener noreferrer" className="font-medium text-cobalt hover:underline">
                      {formatPhoneDisplay(String(l.phone))}
                    </a>
                  ) : (
                    text(l.phone)
                  )}
                </td>
                <td className={tdm} dir="ltr">{text(l.email)}</td>
                <td className="py-2 text-[12px] text-body">{clip(l.message)}</td>
                <td className={td}>{text(l.status)}</td>
                <td className={tdm} dir="ltr">{l.project_id ? String(l.project_id).slice(0, 8) : "—"}</td>
                <td className={tdn}>{l.final_quote_qar == null ? "—" : money(l.final_quote_qar)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      {/* Credits ledger */}
      <Panel title={t("secLedger")} unavailable={why("ledger")} empty={!ledger?.length} noneLabel={t("noneLedger")}>
        {/* no-scroll: Panel wraps every table in overflow-x-auto */}
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-faint">
              <th className={cn(th, "text-start")}>{t("cCreated")}</th>
              <th className={cn(th, "text-start")}>{t("cKind")}</th>
              <th className={cn(th, "text-end")}>{t("cDelta")}</th>
              <th className={cn(th, "text-start")}>{t("cReason")}</th>
              <th className={cn(th, "text-start")}>{t("cNote")}</th>
              <th className={cn(th, "text-start")}>{t("cRedeemable")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-borderstrong/40">
            {(ledger ?? []).map((l) => (
              <tr key={String(l.id)}>
                <td className="py-2 text-[12px] text-mutedtext">{time(l.created_at)}</td>
                <td className={td}>{text(l.kind)}</td>
                <td className={cn(tdn, Number(l.delta ?? 0) < 0 ? "text-body" : "font-semibold text-heading")}>{count(l.delta)}</td>
                <td className={tdm} dir="ltr">{text(l.reason)}</td>
                <td className="py-2 text-[12px] text-body">{clip(l.note, 60)}</td>
                <td className="py-2 text-[12px] text-mutedtext">{day(l.redeemable_until)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      {/* Payments */}
      <Panel title={t("secPayments")} unavailable={why("payments")} empty={!payments?.length} noneLabel={t("nonePayments")}>
        {/* no-scroll: Panel wraps every table in overflow-x-auto */}
        <table className="w-full min-w-[880px] text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-faint">
              <th className={cn(th, "text-start")}>{t("cCreated")}</th>
              <th className={cn(th, "text-start")}>{t("cKind")}</th>
              <th className={cn(th, "text-start")}>{t("cProduct")}</th>
              <th className={cn(th, "text-start")}>{t("cReference")}</th>
              <th className={cn(th, "text-start")}>{t("cStatus")}</th>
              <th className={cn(th, "text-start")}>{t("cTest")}</th>
              <th className={cn(th, "text-end")}>{t("cTokens")}</th>
              <th className={cn(th, "text-end")}>{t("cAuto")}</th>
              <th className={cn(th, "text-end")}>{t("cAmount")}</th>
              <th className={cn(th, "text-end")}>{t("cApproved")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-borderstrong/40">
            {(payments ?? []).map((p) => (
              <tr key={String(p.id)}>
                <td className="py-2 text-[12px] text-mutedtext">{time(p.created_at)}</td>
                <td className={td}>{text(p.kind)}</td>
                <td className={tdm} dir="ltr">{text(p.product)}</td>
                <td className={tdm} dir="ltr">{text(p.reference_code)}</td>
                <td className={td}>{text(p.status)}</td>
                <td className={td}>{yesNo(p.is_test)}</td>
                <td className={tdn}>{count(p.tokens)}</td>
                <td className="py-2 text-end text-[12px] text-mutedtext">{yesNo(p.auto_approved)}</td>
                <td className={cn(tdn, "font-semibold text-heading")}>{money(p.amount_qar)}</td>
                <td className="py-2 text-end text-[12px] text-mutedtext">{time(p.approved_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      {/* Idea pass */}
      <Panel title={t("secPass")} unavailable={why("pass")} empty={!pass} noneLabel={t("nonePass")}>
        {/* no-scroll: Panel wraps every table in overflow-x-auto */}
        <table className="w-full min-w-[420px] text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-faint">
              <th className={cn(th, "text-start")}>{t("cStarted")}</th>
              <th className={cn(th, "text-start")}>{t("cActiveUntil")}</th>
              <th className={cn(th, "text-start")}>{t("cUpdated")}</th>
              <th className={cn(th, "text-end")}>{t("cPayment")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-borderstrong/40">
            <tr>
              <td className="py-2 text-[12px] text-mutedtext">{time(pass?.started_at)}</td>
              <td className="py-2 text-[12.5px] font-semibold text-heading">{time(pass?.active_until)}</td>
              <td className="py-2 text-[12px] text-mutedtext">{time(pass?.updated_at)}</td>
              <td className={cn(tdm, "text-end")} dir="ltr">{pass?.last_payment_id ? String(pass.last_payment_id).slice(0, 8) : "—"}</td>
            </tr>
          </tbody>
        </table>
      </Panel>

      {/* Idea sessions */}
      <Panel title={t("secSessions")} unavailable={why("sessions")} empty={!sessions?.length} noneLabel={t("noneSessions")}>
        {/* no-scroll: Panel wraps every table in overflow-x-auto */}
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-faint">
              <th className={cn(th, "text-start")}>{t("cProject")}</th>
              <th className={cn(th, "text-start")}>{t("cTier")}</th>
              <th className={cn(th, "text-end")}>{t("cEditTurns")}</th>
              <th className={cn(th, "text-end")}>{t("cTokensUsed")}</th>
              <th className={cn(th, "text-end")}>{t("cStarted")}</th>
              <th className={cn(th, "text-end")}>{t("cUpdated")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-borderstrong/40">
            {(sessions ?? []).map((s) => (
              <tr key={String(s.project_id)}>
                <td className={tdm} dir="ltr">{String(s.project_id).slice(0, 8)}</td>
                <td className={td}>{text(s.tier)}</td>
                <td className={tdn}>{count(s.edit_turns)}</td>
                <td className={tdn}>{count(s.tokens_used)}</td>
                <td className="py-2 text-end text-[12px] text-mutedtext">{time(s.started_at)}</td>
                <td className="py-2 text-end text-[12px] text-mutedtext">{time(s.updated_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      {/* AI usage per model */}
      <Panel title={t("secAi")} unavailable={why("usage")} empty={!byModel.length} noneLabel={t("noneAi")}>
        {/* no-scroll: Panel wraps every table in overflow-x-auto */}
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-faint">
              <th className={cn(th, "text-start")}>{t("cModel")}</th>
              <th className={cn(th, "text-end")}>{t("cCalls")}</th>
              <th className={cn(th, "text-end")}>{t("cTokensIn")}</th>
              <th className={cn(th, "text-end")}>{t("cTokensOut")}</th>
              <th className={cn(th, "text-end")}>{t("cCost")}</th>
              <th className={cn(th, "text-end")}>{t("cLastCall")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-borderstrong/40">
            {byModel.map((m) => (
              <tr key={m.model}>
                <td className="py-2 font-mono text-[12px] text-heading" dir="ltr">{m.model}</td>
                <td className={tdn}>{num.format(m.calls)}</td>
                <td className={tdn}>{num.format(m.promptTokens)}</td>
                <td className={tdn}>{num.format(m.completionTokens)}</td>
                <td className={cn(tdn, "font-semibold text-heading")}>{m.unpriced && m.costUsd === 0 ? "—" : usd(m.costUsd)}</td>
                <td className="py-2 text-end text-[12px] text-mutedtext">{time(m.lastCallAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      {/* Engineering jobs */}
      <Panel title={t("secJobs")} unavailable={why("jobs")} empty={!jobs?.length} noneLabel={t("noneJobs")}>
        {/* no-scroll: Panel wraps every table in overflow-x-auto */}
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-faint">
              <th className={cn(th, "text-start")}>{t("cCreated")}</th>
              <th className={cn(th, "text-start")}>{t("cKind")}</th>
              <th className={cn(th, "text-start")}>{t("cStatus")}</th>
              <th className={cn(th, "text-start")}>{t("cProject")}</th>
              <th className={cn(th, "text-start")}>{t("cTest")}</th>
              <th className={cn(th, "text-end")}>{t("cTokens")}</th>
              <th className={cn(th, "text-end")}>{t("cEta")}</th>
              <th className={cn(th, "text-end")}>{t("cReady")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-borderstrong/40">
            {(jobs ?? []).map((j) => (
              <tr key={String(j.id)}>
                <td className="py-2 text-[12px] text-mutedtext">{time(j.created_at)}</td>
                <td className={td}>{text(j.kind)}</td>
                <td className={td}>{text(j.status)}</td>
                <td className={tdm} dir="ltr">{j.project_id ? String(j.project_id).slice(0, 8) : "—"}</td>
                <td className={td}>{yesNo(j.is_test)}</td>
                <td className={tdn}>{count(j.tokens)}</td>
                <td className="py-2 text-end text-[12px] text-mutedtext">{time(j.eta_at)}</td>
                <td className="py-2 text-end text-[12px] text-mutedtext">{time(j.ready_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      {/* CAD generations */}
      <Panel title={t("secCad")} unavailable={why("cad")} empty={!cad?.length} noneLabel={t("noneCad")}>
        {/* no-scroll: Panel wraps every table in overflow-x-auto */}
        <table className="w-full min-w-[880px] text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-faint">
              <th className={cn(th, "text-start")}>{t("cCreated")}</th>
              <th className={cn(th, "text-start")}>{t("cRequest")}</th>
              <th className={cn(th, "text-start")}>{t("cTier")}</th>
              <th className={cn(th, "text-start")}>{t("cStatus")}</th>
              <th className={cn(th, "text-start")}>{t("cModel")}</th>
              <th className={cn(th, "text-start")}>{t("cProject")}</th>
              <th className={cn(th, "text-end")}>{t("cCharged")}</th>
              <th className={cn(th, "text-end")}>{t("cCreditCost")}</th>
              <th className={cn(th, "text-end")}>{t("cDelivered")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-borderstrong/40">
            {(cad ?? []).map((g) => (
              <tr key={String(g.id)} className="align-top">
                <td className="py-2 text-[12px] text-mutedtext">{time(g.created_at)}</td>
                <td className="py-2 text-[12px] text-body">{clip(g.request, 70)}</td>
                <td className={td}>{text(g.tier)}</td>
                <td className={cn(td, g.status === "failed" ? "font-medium text-destructive" : "")}>{text(g.status)}</td>
                <td className={tdm} dir="ltr">{text(g.model)}</td>
                <td className={tdm} dir="ltr">{g.project_id ? String(g.project_id).slice(0, 8) : "—"}</td>
                <td className="py-2 text-end text-[12px] text-mutedtext">{yesNo(g.charged)}</td>
                <td className={tdn}>{count(g.credit_cost)}</td>
                <td className="py-2 text-end text-[12px] text-mutedtext">{time(g.delivered_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      {/* Demand signals */}
      <Panel title={t("secSignals")} unavailable={why("signals")} empty={!signals?.length} noneLabel={t("noneSignals")}>
        {/* no-scroll: Panel wraps every table in overflow-x-auto */}
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-faint">
              <th className={cn(th, "text-start")}>{t("cCreated")}</th>
              <th className={cn(th, "text-start")}>{t("cKind")}</th>
              <th className={cn(th, "text-start")}>{t("cPart")}</th>
              <th className={cn(th, "text-start")}>{t("cSearchTerm")}</th>
              <th className={cn(th, "text-start")}>{t("cSourcePage")}</th>
              <th className={cn(th, "text-start")}>{t("cNote")}</th>
              <th className={cn(th, "text-end")}>{t("cQty")}</th>
              <th className={cn(th, "text-end")}>{t("cServed")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-borderstrong/40">
            {(signals ?? []).map((s) => (
              <tr key={String(s.id)} className="align-top">
                <td className="py-2 text-[12px] text-mutedtext">{time(s.created_at)}</td>
                <td className={td}>{text(s.kind)}</td>
                <td className={tdm} dir="ltr">{s.part_id ? String(s.part_id).slice(0, 8) : text(s.bom_label)}</td>
                <td className="py-2 text-[12px] text-body">{clip(s.search_term, 40)}</td>
                <td className={tdm} dir="ltr">{clip(s.source_page, 40)}</td>
                <td className="py-2 text-[12px] text-body">{clip(s.note, 50)}</td>
                <td className={tdn}>{s.quantity == null ? "—" : count(s.quantity)}</td>
                <td className="py-2 text-end text-[12px] text-mutedtext">{time(s.served_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      {/* Notification outbox */}
      <Panel title={t("secOutbox")} unavailable={why("outbox")} empty={!outbox?.length} noneLabel={t("noneOutbox")}>
        {/* no-scroll: Panel wraps every table in overflow-x-auto */}
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-faint">
              <th className={cn(th, "text-start")}>{t("cCreated")}</th>
              <th className={cn(th, "text-start")}>{t("cKind")}</th>
              <th className={cn(th, "text-start")}>{t("cEmail")}</th>
              <th className={cn(th, "text-start")}>{t("cLocale")}</th>
              <th className={cn(th, "text-start")}>{t("cStatus")}</th>
              <th className={cn(th, "text-start")}>{t("cLastError")}</th>
              <th className={cn(th, "text-end")}>{t("cAttempts")}</th>
              <th className={cn(th, "text-end")}>{t("cSent")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-borderstrong/40">
            {(outbox ?? []).map((n) => (
              <tr key={String(n.id)} className="align-top">
                <td className="py-2 text-[12px] text-mutedtext">{time(n.created_at)}</td>
                <td className={tdm} dir="ltr">{text(n.kind)}</td>
                <td className={tdm} dir="ltr">{text(n.email)}</td>
                <td className={tdm} dir="ltr">{text(n.locale)}</td>
                <td className={td}>{text(n.status)}</td>
                <td className={cn("py-2 text-[12px]", n.last_error ? "font-medium text-destructive" : "text-mutedtext")}>{clip(n.last_error, 50)}</td>
                <td className={tdn}>{count(n.attempts)}</td>
                <td className="py-2 text-end text-[12px] text-mutedtext">{time(n.sent_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}

/**
 * One table in its own panel. An empty section still renders, with its
 * heading and a "none" line, so the owner can see that there is nothing
 * rather than wonder whether the page left it out.
 */
function Panel({
  title,
  unavailable,
  empty,
  noneLabel,
  children,
}: {
  title: string;
  unavailable?: string;
  empty: boolean;
  noneLabel: string;
  children: React.ReactNode;
}) {
  return (
    <section className="neu space-y-3 p-6">
      <h2 className="text-base font-bold text-heading">{title}</h2>
      {unavailable ? (
        <p className="text-sm font-medium text-destructive">{unavailable}</p>
      ) : empty ? (
        <p className="text-sm text-mutedtext">{noneLabel}</p>
      ) : (
        <div className="overflow-x-auto">{children}</div>
      )}
    </section>
  );
}
