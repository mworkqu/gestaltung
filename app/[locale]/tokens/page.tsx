import { getTranslations, setRequestLocale } from "next-intl/server";
import { Coins, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { MessagesScope } from "@/components/i18n/messages-scope";
import { TokenShop } from "@/components/tokens/token-shop";
import { getAuthUser } from "@/lib/auth/get-session";
import { signInHref } from "@/lib/auth/next-path";
import { MAKER_PASS, TOKEN_PACKS, TOKEN_PRICE_QAR } from "@/lib/billing/config";
import { pageMetadata } from "@/lib/seo";
import { IDEATION, TIERS } from "@/lib/studio/tiers";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

// Ideation tokens (owner, 2026-10-18): balance, the optional Maker Pass, the
// pay-per-use packs and the Fawran checkout (TokenShop), then the user's
// payments. Every amount comes from lib/billing/config.ts + lib/studio/tiers.ts.

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Tokens" });
  return pageMetadata({ locale, path: "/tokens", title: t("metaTitle"), description: t("intro"), noindex: true });
}

type Status = { balance: number; pass_balance?: number; bought_balance?: number; pass_until?: string | null; role?: string };
type Payment = { id: string; product: string; amount_qar: number; status: string; reference_code: string; created_at: string; days: number | null; tokens: number };

export default async function TokensPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Tokens");
  const isRtl = locale === "ar";
  const mono = (extra = "") => cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);
  const numLocale = isRtl ? "ar-QA-u-nu-latn" : "en-GB";
  const date = new Intl.DateTimeFormat(numLocale, { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Qatar" });

  const user = await getAuthUser();
  const signedIn = Boolean(user && !user.is_anonymous);
  let status: Status | null = null;
  let payments: Payment[] = [];
  if (signedIn) {
    const supabase = await createClient();
    const [s, p] = await Promise.all([
      supabase.rpc("idea_token_status", { p_project: null }),
      supabase.from("payments").select("id, product, amount_qar, status, reference_code, created_at, days, tokens").order("created_at", { ascending: false }).limit(20),
    ]);
    status = s.error ? null : (s.data as Status);
    payments = p.error ? [] : ((p.data ?? []) as Payment[]);
  }
  const passUntil = status?.pass_until ? new Date(status.pass_until) : null;
  const payg = Math.floor(MAKER_PASS.qar / TOKEN_PRICE_QAR);
  const mult = (id: string) => String(TIERS.find((x) => x.id === id)?.multiplier ?? 1);
  const productName = (p: Payment) =>
    p.product === MAKER_PASS.id ? t("product_maker_pass", { days: String(p.days ?? MAKER_PASS.days) }) : t("product_tokens", { n: String(p.tokens) });

  return (
    <MessagesScope scope="tokens">
      <div className="container max-w-5xl space-y-8 py-8 sm:py-12">
        <header className="space-y-2">
          <p className={mono("text-[10px] text-azure")}>{t("kicker")}</p>
          <h1 className="text-3xl font-extrabold tracking-tight text-heading">{t("title")}</h1>
          <p className="max-w-[65ch] text-sm leading-relaxed text-mutedtext">{t("intro")}</p>
        </header>

        {!signedIn ? (
          <section className="neu flex flex-wrap items-center justify-between gap-4 p-6">
            <p className="text-sm font-medium text-heading">{t("signIn")}</p>
            <Button asChild>
              <a href={signInHref(locale, `/${locale}/tokens`)}>{t("signInCta")}</a>
            </Button>
          </section>
        ) : (
          status && (
            <section className="neu grid gap-4 p-6 sm:grid-cols-[auto_1fr] sm:items-center" data-testid="tokens-balance">
              <div className="flex items-center gap-3">
                <span className="grid h-12 w-12 place-items-center rounded-2xl bg-panel shadow-neu-inset">
                  <Coins className="h-6 w-6 text-cobalt" strokeWidth={1.75} aria-hidden />
                </span>
                <div>
                  <p className="text-xs font-semibold text-mutedtext">{t("balanceTitle")}</p>
                  <p className="text-2xl font-extrabold tabular-nums text-heading">{t("total", { n: String(status.balance) })}</p>
                </div>
              </div>
              <ul className="space-y-1 text-sm text-body sm:justify-self-end sm:text-end">
                <li className="font-semibold text-heading">
                  {passUntil ? t("passActive", { date: date.format(passUntil) }) : t("passNone")}
                </li>
                {passUntil && <li>{t("passTokens", { n: String(status.pass_balance ?? 0) })}</li>}
                <li>{t("bought", { n: String(status.bought_balance ?? status.balance) })}</li>
                {passUntil && <li className="text-xs text-mutedtext">{t("passRenew", { date: date.format(passUntil) })}</li>}
              </ul>
            </section>
          )
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          {/* The optional pass: 2× the tokens its price buys pay-per-use. */}
          <section className="neu relative space-y-4 p-6" data-testid="maker-pass">
            <span className="absolute end-5 top-5 inline-flex items-center gap-1 rounded-full bg-cobalt px-3 py-1 text-xs font-bold text-white">
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
              {t("passBadge")}
            </span>
            <div className="space-y-1">
              <h2 className="text-xl font-extrabold text-heading">{t("passTitle")}</h2>
              <p className="font-mono text-lg font-bold tabular-nums text-heading rtl:font-sans">{t("passPrice", { qar: String(MAKER_PASS.qar) })}</p>
            </div>
            <ul className="list-disc space-y-1.5 ps-5 text-sm leading-relaxed text-body">
              <li className="font-semibold text-heading">
                {t("passLine", { tokens: String(MAKER_PASS.monthlyTokens), qar: String(MAKER_PASS.qar), payg: String(payg) })}
              </li>
              <li>{t("passRollover", { cap: String(MAKER_PASS.rolloverCap) })}</li>
              <li>{t("passOrder")}</li>
              <li>{t("passCancel", { days: String(MAKER_PASS.days) })}</li>
            </ul>
          </section>

          <section className="neu space-y-4 p-6">
            <h2 className="text-base font-bold text-heading">{t("costsTitle")}</h2>
            <ul className="space-y-1.5 text-sm text-body">
              <li>{t("costIdea", { n: String(IDEATION.newIdeaCost) })}</li>
              <li>{t("costEdits", { every: String(IDEATION.turnsPerToken) })}</li>
              <li>{t("costTiers", { maker: mult("maker"), engineer: mult("engineer") })}</li>
            </ul>
            <h2 className="pt-2 text-base font-bold text-heading">{t("packsTitle")}</h2>
            <p className="text-xs text-mutedtext">{t("packEach", { each: String(TOKEN_PRICE_QAR) })}</p>
          </section>
        </div>

        {signedIn && (
          <TokenShop
            locale={locale}
            hasPass={Boolean(passUntil)}
            packs={TOKEN_PACKS.map((p) => ({ id: p.id, tokens: p.tokens, qar: p.qar }))}
            pass={{ id: MAKER_PASS.id, qar: MAKER_PASS.qar, days: MAKER_PASS.days }}
          />
        )}

        {signedIn && (
          <section className="neu space-y-3 p-6">
            <h2 className="text-base font-bold text-heading">{t("historyTitle")}</h2>
            {payments.length === 0 ? (
              <p className="text-sm text-mutedtext">{t("none")}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-sm">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wider text-faint">
                      <th className="pb-2 text-start font-medium">{t("colDate")}</th>
                      <th className="pb-2 text-start font-medium">{t("colProduct")}</th>
                      <th className="pb-2 text-end font-medium">{t("colAmount")}</th>
                      <th className="pb-2 text-start font-medium">{t("colRef")}</th>
                      <th className="pb-2 text-start font-medium">{t("colStatus")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-borderstrong/40">
                    {payments.map((p) => (
                      <tr key={p.id}>
                        <td className="py-2 text-mutedtext">{date.format(new Date(p.created_at))}</td>
                        <td className="py-2 text-heading">{productName(p)}</td>
                        <td className="py-2 text-end font-mono tabular-nums">{Number(p.amount_qar)}</td>
                        <td className="py-2 font-mono text-xs" dir="ltr">{p.reference_code}</td>
                        <td className="py-2">{t(`status_${p.status}`)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

      </div>
    </MessagesScope>
  );
}
