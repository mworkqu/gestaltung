// W2 (2026-10-11): the "Request received" page body (server component, no 3D,
// no client JS). Used by /[locale]/projects/[id]/request and its e2e fixture.
// The enclosure picture is a small flat drawing in the chosen colour (no stored
// render exists; the share picture is made in the browser and never saved).

import { getTranslations } from "next-intl/server";
import { CheckCircle2, MessageCircle } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { MECH_NAMES } from "@/lib/studio/mech/names";
import { COLOUR_HEX } from "@/lib/studio/palette";
import type { RequestSummary } from "@/lib/studio/request-summary";
import type { Colour, MechTemplate } from "@/lib/studio/schema";
import { asLocale, intlTag } from "@/lib/locale";

const ROUND = new Set(["puck", "dome_base", "lantern", "pill"]);

function CasePicture({ template, colour, label }: { template: string; colour: string; label: string }) {
  const fill = COLOUR_HEX[colour as Colour] ?? COLOUR_HEX.chalk;
  const round = ROUND.has(template);
  return (
    <svg viewBox="0 0 240 160" role="img" aria-label={label} className="h-full w-full" data-testid="studio-request-picture">
      <ellipse cx="120" cy="138" rx="78" ry="10" fill="#cfd8e4" />
      {round ? (
        <>
          <path d="M52 110 Q52 46 120 40 Q188 46 188 110 Z" fill={fill} stroke="#1c2434" strokeOpacity="0.18" strokeWidth="2" />
          <rect x="46" y="106" width="148" height="24" rx="12" fill={fill} stroke="#1c2434" strokeOpacity="0.18" strokeWidth="2" />
        </>
      ) : (
        <>
          <path d="M60 58 L120 36 L180 58 L120 80 Z" fill={fill} stroke="#1c2434" strokeOpacity="0.18" strokeWidth="2" />
          <path d="M60 58 L120 80 L120 132 L60 110 Z" fill={fill} stroke="#1c2434" strokeOpacity="0.18" strokeWidth="2" />
          <path d="M180 58 L120 80 L120 132 L180 110 Z" fill={fill} stroke="#1c2434" strokeOpacity="0.18" strokeWidth="2" />
          <path d="M60 58 L120 80 L120 132 L60 110 Z" fill="#1c2434" fillOpacity="0.06" />
          <path d="M180 58 L120 80 L120 132 L180 110 Z" fill="#1c2434" fillOpacity="0.14" />
        </>
      )}
      <circle cx={round ? 120 : 150} cy={round ? 86 : 92} r="5" fill="#3ea6ff" fillOpacity="0.85" />
    </svg>
  );
}

function qar(n: number, locale: string): string {
  return new Intl.NumberFormat(locale === "ar" ? "ar-QA-u-nu-latn" : "en-QA", { maximumFractionDigits: 0 }).format(n);
}

export async function RequestReceived({
  summary,
  locale,
  designHref,
  ownerQuote = null,
}: {
  summary: RequestSummary;
  locale: string;
  /** Back to the Studio (the real project, or the e2e fixture). */
  designHref: string;
  /** W2b: the price the owner quoted in the admin; replaces the estimate range. */
  ownerQuote?: { finalQar: number; note: string | null } | null;
}) {
  const t = await getTranslations({ locale, namespace: "StudioRequest" });
  const tS = await getTranslations({ locale, namespace: "Studio" });
  const lang = asLocale(locale);
  const sentOn = summary.requestedAt
    ? new Intl.DateTimeFormat(intlTag(asLocale(locale)), { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Qatar" }).format(
        new Date(summary.requestedAt),
      )
    : null;
  const e = summary.enclosure;

  return (
    <div className="space-y-5" data-testid="studio-request-page">
      <section className="neu space-y-4 p-6 sm:p-8" aria-labelledby="request-title">
        <p className="kicker font-semibold text-cobalt">{t("kicker")}</p>
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-1 h-8 w-8 shrink-0 text-buy" strokeWidth={1.5} aria-hidden />
          <div className="space-y-2">
            <h1 id="request-title" className="title-page">
              {summary.requestedAt ? tS("requestReceived") : summary.name}
            </h1>
            {sentOn && <p className="text-sm text-mutedtext">{t("sentOn", { date: sentOn })}</p>}
          </div>
        </div>
        {summary.requestedAt ? (
          <>
            <p className="tile flex items-center gap-3 border-0 bg-[#e3f4ea] p-4 text-base font-semibold text-heading" data-testid="studio-request-whatsapp">
              <MessageCircle className="h-5 w-5 shrink-0 text-buy" strokeWidth={1.75} aria-hidden />
              {tS("requestReceivedText")}
            </p>
            <p className="max-w-prose text-sm leading-relaxed text-body">{t("intro")}</p>
          </>
        ) : (
          <p className="text-sm text-body">{t("notSent")}</p>
        )}
        <div className="flex flex-wrap gap-3">
          <Link
            href="/projects"
            className="inline-flex min-h-12 items-center justify-center rounded-full bg-cobalt px-7 text-sm font-semibold text-white hover:bg-cobalt-hover"
          >
            {t("myProjects")}
          </Link>
          <Link href={designHref} className="inline-flex min-h-12 items-center rounded-full px-4 text-sm font-semibold text-cobalt hover:text-cobalt-hover">
            {t("backToDesign")}
          </Link>
        </div>
      </section>

      <section className="neu space-y-5 p-6 sm:p-8" aria-labelledby="request-summary">
        <div className="space-y-1">
          <h2 id="request-summary" className="title-section">
            {t("summaryTitle")}
          </h2>
          <p className="text-lg font-bold text-heading" data-testid="studio-request-name">
            {summary.name}
          </p>
          {summary.oneLine && <p className="max-w-prose text-sm text-body">{summary.oneLine}</p>}
        </div>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <div className="tile flex flex-col items-center gap-2 p-4">
            <div className="aspect-[3/2] w-full max-w-xs">
              <CasePicture
                template={e?.template ?? "rounded_box"}
                colour={e?.colour ?? "mist"}
                label={e ? t("pictureAlt", { colour: tS(`colour_${e.colour}`), finish: tS(`finish_${e.finish}`) }) : t("noEnclosure")}
              />
            </div>
            <p className="text-center text-sm text-mutedtext">
              {e ? `${tS(`colour_${e.colour}`)} · ${tS(`finish_${e.finish}`)}` : t("noEnclosure")}
            </p>
          </div>

          <div className="space-y-5">
            <div className="space-y-2">
              <h3 className="title-card">{t("partsTitle")}</h3>
              {summary.parts.length ? (
                <ul className="space-y-1.5 text-sm" data-testid="studio-request-parts">
                  {summary.parts.map((p) => (
                    <li key={p.id} className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 text-heading">{p.name}</span>
                      {!p.priced && <span className="shrink-0 text-xs text-mutedtext">{t("weSource")}</span>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-mutedtext">{t("partsEmpty")}</p>
              )}
            </div>

            <div className="space-y-2">
              <h3 className="title-card">{t("printedTitle")}</h3>
              {summary.printed.length ? (
                <>
                  <ul className="space-y-1.5 text-sm" data-testid="studio-request-printed">
                    {summary.printed.map((r) => {
                      const own = lang === "ar" ? r.name_ar : r.name;
                      const name = MECH_NAMES[r.template as MechTemplate]?.[lang] ?? own ?? r.template;
                      return (
                        <li key={`${r.template}:${r.material}`} className="flex items-baseline justify-between gap-3">
                          <span className="min-w-0 text-heading">
                            {r.count > 1 ? t("printedRow", { name, count: String(r.count) }) : name}
                            <span className="text-mutedtext"> · {tS(`material_${r.material}`)}</span>
                          </span>
                          <span className="shrink-0 text-xs text-mutedtext">{t("printedGrams", { g: String(r.grams) })}</span>
                        </li>
                      );
                    })}
                  </ul>
                  <p className="text-xs text-mutedtext">{t("printedTotal", { g: String(summary.printedGrams) })}</p>
                </>
              ) : (
                <p className="text-sm text-mutedtext">{t("printedEmpty")}</p>
              )}
            </div>
          </div>
        </div>
      </section>

      {ownerQuote ? (
        <section className="neu space-y-3 p-6 sm:p-8" aria-labelledby="request-quote" data-testid="studio-request-quote">
          <h2 id="request-quote" className="title-section">
            {t("quoteTitle")}
          </h2>
          <p className="text-2xl font-extrabold text-heading" dir={lang === "ar" ? "rtl" : "ltr"}>
            {t("quoteAmount", { amount: qar(ownerQuote.finalQar, locale) })}
          </p>
          {ownerQuote.note && <p className="max-w-prose whitespace-pre-line text-sm text-body" data-testid="studio-request-quote-note">{ownerQuote.note}</p>}
          <p className="max-w-prose text-sm text-mutedtext">{t("quoteText")}</p>
        </section>
      ) : (
      <section className="neu space-y-3 p-6 sm:p-8" aria-labelledby="request-estimate" data-testid="studio-request-estimate">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="request-estimate" className="title-section">
            {t("estimateTitle")}
          </h2>
          <span className="rounded-full bg-[#fff3d6] px-3 py-1 text-xs font-semibold text-[#7a5200]">{t("estimateLabel")}</span>
        </div>
        {summary.estimate ? (
          <p className="text-2xl font-extrabold text-heading" dir={lang === "ar" ? "rtl" : "ltr"}>
            {t("estimateRange", { low: qar(summary.estimate.low, locale), high: qar(summary.estimate.high, locale) })}
          </p>
        ) : null}
        <p className="max-w-prose text-sm text-body">{summary.estimate ? t("estimateNote") : t("estimateNone")}</p>
      </section>
      )}
    </div>
  );
}
