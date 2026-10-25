import { ServicesPanel } from "@/components/services/services-panel";
import { SERVICE_KINDS, quoteService, serviceReady } from "@/lib/services/quote";
import { engineerServicePrices } from "@/lib/services/server";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { MessagesScope } from "@/components/i18n/messages-scope";
import { StepPanel, type JobView } from "@/components/engineering/step-panel";
import { CopyCode, DownloadJson } from "@/components/engineering/actions";
import { Link } from "@/i18n/navigation";
import { getAuthUser, getSessionContext } from "@/lib/auth/get-session";
import { signInHref } from "@/lib/auth/next-path";
import { ENGINEERING_BUCKET, STEP_JOB } from "@/lib/engineering/config";
import { buildBom, buildConnections, pinsByComponent, powerBudget } from "@/lib/engineering/view";
import { pageMetadata } from "@/lib/seo";
import { CODE_LIBRARY } from "@/lib/studio/library";
import { studioLibrary } from "@/lib/studio/library/remote";
import { StudioDocSchema, type StudioDoc } from "@/lib/studio/schema";
import { tierOf } from "@/lib/studio/tiers";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { cn } from "@/lib/utils";
import { intlTag, asLocale } from "@/lib/locale";
import { UUID_RE } from "@/lib/uuid";

// Engineering view (owner, 2026-10-18): the whole project as an engineer reads
// it: parts, connections, power, checks; and for Engineers-level projects the
// pin-level netlist, enclosure, printable parts, firmware and the full STEP
// file request. Read under the visitor's own session (RLS), guests included.

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Engineering" });
  return pageMetadata({ locale, path: "/projects", title: t("metaTitle"), noindex: true });
}

type JobRow = {
  id: string;
  user_id: string;
  status: string;
  created_at: string;
  eta_at: string | null;
  result_path: string | null;
  result_name: string | null;
  returned_at: string | null;
};

function Th({ children, end }: { children: React.ReactNode; end?: boolean }) {
  return <th className={cn("pb-2 font-medium", end ? "text-end" : "text-start")}>{children}</th>;
}

export default async function EngineeringPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Engineering");
  const isRtl = locale === "ar";
  const lang: "en" | "ar" = isRtl ? "ar" : "en";
  const mono = (extra = "") => cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);
  const when = new Intl.DateTimeFormat(intlTag(asLocale(locale)), {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Qatar",
  });

  const user = await getAuthUser();
  const supabase = await createClient();
  type ProjectRow = { name: string | null; studio: unknown };
  let project: ProjectRow | null = null;
  if (user && UUID_RE.test(id)) {
    const { data } = await supabase.from("projects").select("name, studio").eq("id", id).maybeSingle();
    project = (data as ProjectRow | null) ?? null;
  }

  if (!user || !project) {
    return (
      <div className="container max-w-3xl py-10">
        <section className="neu space-y-4 p-6 text-center">
          <p className="text-base font-semibold text-heading">{user ? t("notFound") : t("signInNeeded")}</p>
          {!user && (
            <a className="inline-flex min-h-11 items-center font-semibold text-cobalt" href={signInHref(locale, `/${locale}/projects/${id}/engineering`)}>
              {t("signIn")}
            </a>
          )}
        </section>
      </div>
    );
  }

  const parsed = StudioDocSchema.safeParse(project.studio);
  const doc: StudioDoc | null = parsed.success ? parsed.data : null;
  const { getPart } = await studioLibrary().catch(() => CODE_LIBRARY);

  const session = await getSessionContext(user).catch(() => null);
  const isAdmin = session?.profile.role === "super_admin";
  const signedIn = !user.is_anonymous;

  // The project's jobs (RLS: own rows). A missing table (before 0091) means none.
  const jobsRes = await supabase
    .from("engineering_jobs")
    .select("id, user_id, kind, status, created_at, eta_at, result_path, result_name, returned_at")
    .eq("project_id", id)
    .order("created_at", { ascending: false })
    .limit(20);
  const rows = jobsRes.error ? [] : ((jobsRes.data ?? []) as JobRow[]);

  // Signed download links: the result lives under jobs/<id>/..., which the user cannot read under
  // storage RLS, so the server signs it (1 hour) after checking the job is the viewer's.
  const service = createServiceClient();
  const jobs: JobView[] = await Promise.all(
    rows.map(async (j) => {
      let downloadUrl: string | null = null;
      if (j.status === "ready" && j.result_path && service && (j.user_id === user.id || isAdmin)) {
        const { data } = await service.storage.from(ENGINEERING_BUCKET).createSignedUrl(j.result_path, 3600, { download: j.result_name ?? true });
        downloadUrl = data?.signedUrl ?? null;
      }
      return {
        id: j.id,
        kind: (j as { kind?: string }).kind ?? "step_model",
        status: j.status,
        createdLabel: when.format(new Date(j.created_at)),
        etaLabel: j.eta_at ? when.format(new Date(j.eta_at)) : null,
        resultName: j.result_name,
        downloadUrl,
        returned: Boolean(j.returned_at),
      };
    }),
  );

  const servicePrices = await engineerServicePrices(supabase);
  const spec = doc?.spec;
  const tier = tierOf(spec);
  const full = tier.id === "engineer" || rows.length > 0 || isAdmin;
  const u = spec?.understanding;
  const hasParts = Boolean(doc && doc.components.length > 0);
  const bom = doc && hasParts ? buildBom(doc, getPart, lang) : [];
  const connections = doc ? buildConnections(doc, getPart) : [];
  const budget = doc && hasParts ? powerBudget(doc, getPart) : null;
  const studioHref = `/projects/${id}/studio`;
  const name = spec?.name ?? project.name ?? "";

  const emptyParts = (
    <p className="text-sm text-mutedtext">
      {t("emptyParts")}{" "}
      <Link href={studioHref} className="font-semibold text-cobalt hover:text-cobalt-hover">
        {t("openStudio")}
      </Link>
    </p>
  );
  const partsList = (xs: { name: string; count: number; purpose?: string }[]) =>
    xs.map((p, i) => (
      <li key={`${p.name}-${i}`} className="flex flex-wrap gap-x-2 text-sm text-body" dir="auto">
        <span className="font-semibold text-heading">{p.name}</span>
        <span className="font-mono tabular-nums text-mutedtext">×{p.count}</span>
        {p.purpose && <span className="text-mutedtext">{p.purpose}</span>}
      </li>
    ));

  return (
    <MessagesScope scope="engineering">
      <div className="container max-w-5xl space-y-6 py-8 sm:py-12">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-2">
            <p className={mono("text-[10px] text-azure")}>{t("kicker")}</p>
            <h1 className="text-3xl font-extrabold tracking-tight text-heading" dir="auto">
              {name}
            </h1>
            <span className="inline-flex items-center rounded-full bg-panel px-3 py-1 text-xs font-bold text-cobalt shadow-neu-inset" data-testid="engineering-tier">
              {t(`tier_${tier.id}`)}
            </span>
          </div>
          <Link href={studioHref} className="inline-flex min-h-11 items-center text-sm font-semibold text-cobalt hover:text-cobalt-hover">
            {t("backToStudio")}
          </Link>
        </header>

        <section className="neu space-y-4 p-6">
          <h2 className="text-base font-bold text-heading">{t("understandingTitle")}</h2>
          {u || spec?.oneLine ? (
            <div className="space-y-4">
              {u?.goal && (
                <div>
                  <p className={mono("text-[10px] text-faint")}>{t("goal")}</p>
                  <p className="text-sm leading-relaxed text-body" dir="auto">
                    {u.goal}
                  </p>
                </div>
              )}
              {u?.howItWorks && (
                <div>
                  <p className={mono("text-[10px] text-faint")}>{t("howItWorks")}</p>
                  <p className="text-sm leading-relaxed text-body" dir="auto">
                    {u.howItWorks}
                  </p>
                </div>
              )}
              {!u && spec?.oneLine && (
                <p className="text-sm leading-relaxed text-body" dir="auto">
                  {spec.oneLine}
                </p>
              )}
              {u && (
                <div className="tile space-y-2">
                  <p className={mono("text-[10px] text-faint")}>{t("partsNeeded")}</p>
                  <ul className="space-y-1">
                    {u.controller && partsList([{ name: u.controller, count: 1 }])}
                    {partsList(u.sensors)}
                    {partsList(u.actuators)}
                    {partsList(u.outputs)}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            emptyParts
          )}
        </section>

        <section className="neu space-y-3 p-6" data-testid="engineering-bom">
          <h2 className="text-base font-bold text-heading">{t("bomTitle")}</h2>
          {bom.length === 0 ? (
            emptyParts
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-faint">
                    <Th>{t("colPart")}</Th>
                    <Th>{t("colCategory")}</Th>
                    <Th end>{t("colQty")}</Th>
                    <Th>{t("colSku")}</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-borderstrong/40">
                  {bom.map((b) => (
                    <tr key={b.partId}>
                      <td className="py-2 font-semibold text-heading" dir="auto">
                        {b.name}
                      </td>
                      <td className="py-2 text-mutedtext">{b.category ? t(`cat_${b.category}`) : "—"}</td>
                      <td className="py-2 text-end font-mono tabular-nums">{b.qty}</td>
                      <td className="py-2 font-mono text-xs text-mutedtext" dir="ltr">
                        {b.skus.join(", ") || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="neu space-y-3 p-6" data-testid="engineering-connections">
          <h2 className="text-base font-bold text-heading">{t("connectionsTitle")}</h2>
          {connections.length === 0 ? (
            <p className="text-sm text-mutedtext">
              {hasParts ? t("emptyWiring") : t("emptyParts")}{" "}
              <Link href={studioHref} className="font-semibold text-cobalt hover:text-cobalt-hover">
                {t("openStudio")}
              </Link>
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-faint">
                    <Th>{t("colNet")}</Th>
                    <Th>{t("colPins")}</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-borderstrong/40">
                  {connections.map((c, i) => (
                    <tr key={`${c.net}-${i}`}>
                      <td className="py-2 pe-3 align-top font-mono text-xs font-semibold text-heading" dir="ltr">
                        {c.net}
                      </td>
                      <td className="py-2 text-body" dir="auto">
                        {c.pins.map((p, j) => (
                          <span key={j} className="me-2 inline-block">
                            {p.part} · {p.pin}
                            {j < c.pins.length - 1 ? "," : ""}
                          </span>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="grid gap-6 md:grid-cols-2">
          <section className="neu space-y-3 p-6" data-testid="engineering-power">
            <h2 className="text-base font-bold text-heading">{t("powerTitle")}</h2>
            {!budget ? (
              emptyParts
            ) : (
              <div className="tile space-y-1.5 text-sm">
                <p className="text-body">
                  {t("powerDraw")} <span className="font-mono font-bold tabular-nums text-heading">{budget.drawMA} mA</span>
                </p>
                {budget.supplyMA !== null ? (
                  <>
                    <p className="text-body">
                      {t("powerSupply")} <span className="font-mono font-bold tabular-nums text-heading">{budget.supplyMA} mA</span>
                    </p>
                    <p className={cn("font-bold", budget.ok ? "text-emerald-700" : "text-red-700")}>{budget.ok ? t("powerOk") : t("powerOver")}</p>
                  </>
                ) : (
                  <p className="text-mutedtext">{t("powerNoSupply")}</p>
                )}
              </div>
            )}
          </section>

          <section className="neu space-y-3 p-6" data-testid="engineering-checks">
            <h2 className="text-base font-bold text-heading">{t("checksTitle")}</h2>
            {!doc || doc.checks.length === 0 ? (
              <p className="text-sm text-mutedtext">{t("emptyChecks")}</p>
            ) : (
              <ul className="space-y-2">
                {doc.checks.map((c) => (
                  <li key={c.id} className="flex gap-2 text-sm text-body" dir="auto">
                    <span className={cn("shrink-0 font-bold", c.ok ? "text-emerald-700" : "text-red-700")}>{c.ok ? t("checkOk") : t("checkFail")}</span>
                    <span>{c.plain}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {full && doc && (
          <>
            <section className="neu space-y-3 p-6" data-testid="engineering-pins">
              <h2 className="text-base font-bold text-heading">{t("pinsTitle")}</h2>
              {doc.netlist.nets.length === 0 ? (
                <p className="text-sm text-mutedtext">{t("emptyWiring")}</p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {pinsByComponent(doc, getPart).map((c, i) => (
                    <div key={`${c.label}-${i}`} className="tile space-y-2">
                      <p className="text-sm font-bold text-heading" dir="auto">
                        {c.label}
                      </p>
                      {c.rows.length === 0 ? (
                        <p className="text-xs text-mutedtext">—</p>
                      ) : (
                        <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <tbody className="divide-y divide-borderstrong/40">
                            {c.rows.map((r, j) => (
                              <tr key={j}>
                                <td className="py-1 pe-2 text-mutedtext" dir="auto">
                                  {r.pin}
                                </td>
                                <td className="py-1 text-end font-mono font-semibold text-heading" dir="ltr">
                                  {r.net}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="neu space-y-3 p-6" data-testid="engineering-enclosure">
              <h2 className="text-base font-bold text-heading">{t("enclosureTitle")}</h2>
              {!doc.enclosure ? (
                <p className="text-sm text-mutedtext">{t("emptyEnclosure")}</p>
              ) : (
                <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {(
                    [
                      ["template", doc.enclosure.template],
                      ["wall", `${doc.enclosure.wall} mm`],
                      ["clearance", `${doc.enclosure.clearance} mm`],
                      ["cornerRadius", `${doc.enclosure.cornerRadius} mm`],
                      ["edgeFillet", `${doc.enclosure.edgeFillet} mm`],
                      ["lid", doc.enclosure.lid],
                      ["vents", doc.enclosure.vents.pattern === "none" ? "—" : `${doc.enclosure.vents.pattern} ×${doc.enclosure.vents.count}`],
                      ["feet", doc.enclosure.feet],
                      ["finish", doc.enclosure.finish],
                      ["colour", doc.enclosure.colour],
                      ["ratio", String(doc.enclosure.proportions.widthToDepth)],
                      ["height", doc.enclosure.proportions.heightBias],
                    ] as const
                  ).map(([k, v]) => (
                    <div key={k} className="tile !p-3">
                      <dt className={mono("text-[10px] text-faint")}>{t(`enc_${k}`)}</dt>
                      <dd className="font-mono text-sm font-semibold tabular-nums text-heading" dir="ltr">
                        {v}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </section>

            <section className="neu space-y-3 p-6" data-testid="engineering-mech">
              <h2 className="text-base font-bold text-heading">{t("mechTitle")}</h2>
              {doc.mech.length === 0 ? (
                <p className="text-sm text-mutedtext">{t("emptyMech")}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[420px] text-sm">
                    <thead>
                      <tr className="text-[10px] uppercase tracking-wider text-faint">
                        <Th>{t("colMechPart")}</Th>
                        <Th>{t("colMaterial")}</Th>
                        <Th end>{t("colGrams")}</Th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-borderstrong/40">
                      {doc.mech.map((m) => (
                        <tr key={m.id}>
                          <td className="py-2 font-semibold text-heading" dir="ltr">
                            {m.template}
                          </td>
                          <td className="py-2 font-mono text-xs" dir="ltr">
                            {m.printable.material}
                          </td>
                          <td className="py-2 text-end font-mono tabular-nums">{Math.round(m.printable.estGrams)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="neu space-y-3 p-6" data-testid="engineering-firmware">
              <h2 className="text-base font-bold text-heading">{t("firmwareTitle")}</h2>
              {!doc.firmware ? (
                <p className="text-sm text-mutedtext">{t("emptyFirmware")}</p>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-body">
                    {t("board")}{" "}
                    <span className="font-mono font-bold text-heading" dir="ltr">
                      {doc.firmware.board}
                    </span>
                  </p>
                  <CopyCode code={doc.firmware.code} />
                </div>
              )}
            </section>

            <div className="flex flex-wrap items-center gap-3">
              <DownloadJson doc={doc} fileName={`${(name || "project").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.json`} />
            </div>
          </>
        )}

        {/* Engineers level: anyone signed in can ask for the full STEP file; the full view follows. */}
        <StepPanel
          projectId={id}
          userId={user.id}
          signedIn={signedIn}
          tokens={STEP_JOB.tokens}
          etaMin={STEP_JOB.etaHours.min}
          etaMax={STEP_JOB.etaHours.max}
          jobs={jobs}
        />

        {/* 0092: engineer services, priced from this project before payment. */}
        <ServicesPanel
          projectId={id}
          signedIn={signedIn}
          cards={SERVICE_KINDS.map((kind) => ({
            kind,
            quote: doc && serviceReady(kind, doc) ? quoteService(kind, doc, servicePrices) : null,
            ready: serviceReady(kind, doc),
            open: rows.some((r) => (r as { kind?: string }).kind === kind && (r.status === "queued" || r.status === "in_progress")),
          }))}
        />
      </div>
    </MessagesScope>
  );
}
