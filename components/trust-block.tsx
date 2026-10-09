import { getLocale, getTranslations } from "next-intl/server";
import { ArrowRight, Building2, Database, Lock, MessageCircle, RotateCcw, type LucideIcon } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { COMPANY, COMPANY_ADDRESS, COMPANY_WHATSAPP } from "@/lib/company";
import { getTrustedBy } from "@/lib/store/public-catalog";
import { cn } from "@/lib/utils";

// Trust (P1-04 / WF-04 / WF-21). Server components only, no client messages:
//   <TrustBlock />      compact block above the footer on every public page
//                       (app/[locale]/layout.tsx, inside <TrustGate>)
//   <TrustItemCards />  the same five promises as full cards on /trust
//   <TrustedBy />       logo row from store_settings.trusted_by; renders
//                       nothing at all while the key is missing or empty
// Every item is a promise the studio keeps; the legal name, C.R. number,
// address and WhatsApp line come from lib/company.ts, never from copy.

type ItemId = "files" | "data" | "contact" | "registered" | "warranty";

const ITEMS: { id: ItemId; icon: LucideIcon }[] = [
  { id: "files", icon: Lock },
  { id: "data", icon: Database },
  { id: "contact", icon: MessageCircle },
  { id: "registered", icon: Building2 },
  { id: "warranty", icon: RotateCcw },
];

const linkCls =
  "inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-cobalt transition-colors hover:text-cobalt-hover";

export async function TrustItemCards({ full = false }: { full?: boolean }) {
  const locale = await getLocale();
  const t = await getTranslations("Trust");
  const isRtl = locale === "ar";
  const arrow = cn("h-4 w-4", isRtl && "-scale-x-100");

  const registered = t("registeredText", {
    name: isRtl ? COMPANY.legalNameAr : COMPANY.legalNameEn,
    cr: COMPANY.crNumber,
    address: COMPANY_ADDRESS[isRtl ? "ar" : "en"],
  });

  // Short text of each item (the warranty item is a title and a link only).
  const text: Record<ItemId, string | null> = {
    files: t("filesText"),
    data: t("dataText"),
    contact: t("contactText"),
    registered,
    warranty: null,
  };
  const more: Record<ItemId, string> = {
    files: t("filesMore"),
    data: t("dataMore"),
    contact: t("contactMore"),
    registered: t("registeredMore"),
    warranty: t("warrantyMore"),
  };

  const link = (id: ItemId) => {
    if (id === "data")
      return (
        <Link href="/privacy" className={linkCls}>
          {t("dataLink")}
          <ArrowRight className={arrow} aria-hidden />
        </Link>
      );
    if (id === "warranty")
      return (
        <Link href="/warranty" className={linkCls}>
          {t("warrantyLink")}
          <ArrowRight className={arrow} aria-hidden />
        </Link>
      );
    if (id === "contact")
      return (
        <a href={COMPANY_WHATSAPP.url} target="_blank" rel="noopener noreferrer" className={linkCls}>
          {t.rich("contactLink", { number: COMPANY_WHATSAPP.display, n: (chunks) => <span dir="ltr">{chunks}</span> })}
        </a>
      );
    return null;
  };

  return (
    <ul className={cn("grid gap-4 md:grid-cols-2 lg:grid-cols-3", full && "gap-5")}>
      {ITEMS.map(({ id, icon: Icon }) => (
        <li key={id} className="flex min-w-0 flex-col gap-2 rounded-2xl bg-panel p-5 shadow-neu-sm">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface text-cobalt shadow-neu-sm">
            <Icon className="h-5 w-5" strokeWidth={1.5} aria-hidden />
          </span>
          <h3 className="mt-2 text-base font-bold text-heading">{t(`${id}Title`)}</h3>
          {text[id] && <p className="text-sm leading-relaxed text-body">{text[id]}</p>}
          {full && <p className="text-sm leading-relaxed text-mutedtext">{more[id]}</p>}
          <div className="mt-auto">{link(id)}</div>
        </li>
      ))}
    </ul>
  );
}

/** "Trusted by" logos. Nothing (no heading, no placeholder) when store_settings.trusted_by is missing or empty. */
export async function TrustedBy() {
  const logos = await getTrustedBy();
  if (!logos.length) return null;
  const [t, locale] = await Promise.all([getTranslations("Trust"), getLocale()]);
  const isRtl = locale === "ar";
  return (
    <div className="space-y-3 border-t border-borderstrong/40 pt-5">
      <h3 className={cn("text-[11px] text-mutedtext", isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]")}>
        {t("trustedTitle")}
      </h3>
      <ul className="flex flex-wrap items-center gap-x-8 gap-y-2">
        {logos.map((l) => {
          const img = (
            // Logos come from any host the owner chooses, so a plain <img> (no next/image remotePatterns).
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={l.logo_url}
              alt={l.name}
              width={128}
              height={40}
              loading="lazy"
              decoding="async"
              className="h-8 w-auto max-w-[8rem] object-contain opacity-80"
            />
          );
          return (
            <li key={`${l.name}-${l.logo_url}`}>
              {l.href ? (
                <a href={l.href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center">
                  {img}
                </a>
              ) : (
                <span className="inline-flex min-h-11 items-center">{img}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export async function TrustBlock() {
  const locale = await getLocale();
  const t = await getTranslations("Trust");
  const isRtl = locale === "ar";
  return (
    <section aria-labelledby="trust-heading" className="container pt-6">
      <div className="neu space-y-6 p-6 sm:p-8">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div className="space-y-1">
            <span className={cn("text-[10px] text-cobalt", isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]")}>
              {t("kicker")}
            </span>
            <h2 id="trust-heading" className="text-2xl font-extrabold tracking-tight text-heading sm:text-3xl">
              {t("heading")}
            </h2>
          </div>
          <Link href="/trust" className={linkCls}>
            {t("readMore")}
            <ArrowRight className={cn("h-4 w-4", isRtl && "-scale-x-100")} aria-hidden />
          </Link>
        </div>
        <TrustItemCards />
        <TrustedBy />
      </div>
    </section>
  );
}
