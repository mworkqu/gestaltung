import { CircleAlert, ShieldCheck } from "lucide-react";
import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { getAuthUserCached } from "@/lib/auth/guards";
import { signInHref } from "@/lib/auth/next-path";
import { asLocale } from "@/lib/locale";
import { companyLine } from "@/lib/meetings/copy";
import { createClient } from "@/lib/supabase/server";
import { approveAction, denyAction } from "./actions";

// The consent page of Phase 4a (chat plugin sign-in).
//
// Supabase Auth is the OAuth 2.1 authorization server; this is the one screen
// it does not host. It sends the person here with ?authorization_id=…, we show
// who is asking and what it would be allowed to do, and the decision goes back
// through actions.ts.
//
// It is never indexed, it is always dynamic (it depends on the person's
// session), and it shows nothing at all without one.
export const dynamic = "force-dynamic";

export const metadata = { robots: { index: false, follow: false } };

const card = "neu mx-auto w-full max-w-lg space-y-4 p-5 sm:p-8";
const button =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-cobalt px-6 text-sm font-semibold text-white transition-colors hover:bg-cobalt-hover active:scale-[0.98] disabled:opacity-60";
const ghost =
  "inline-flex min-h-11 items-center px-2 text-sm font-semibold text-cobalt underline-offset-2 hover:underline disabled:opacity-60";

const AUTH_ID = /^[A-Za-z0-9._~-]{8,200}$/;

type Query = { authorization_id?: string | string[]; error?: string | string[] };

const one = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? "") : (v ?? ""));

export default async function ConsentPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Query>;
}) {
  const { locale: rawLocale } = await params;
  setRequestLocale(rawLocale);
  const locale = asLocale(rawLocale);
  const t = await getTranslations({ locale, namespace: "OauthConsent" });

  const query = await searchParams;
  const authorizationId = one(query.authorization_id).trim();
  const failed = one(query.error);

  const Card = ({ children }: { children: React.ReactNode }) => (
    <main className="container flex min-h-[60vh] items-center py-10">
      <div className={card} data-testid="consent-card">
        {children}
      </div>
    </main>
  );

  const Problem = ({ title, body, state }: { title: string; body: string; state: string }) => (
    <Card>
      <h1 className="flex items-center gap-2 text-xl font-black tracking-tight text-heading">
        <CircleAlert className="h-5 w-5 text-destructive" strokeWidth={1.5} aria-hidden />
        {title}
      </h1>
      <p className="text-sm text-body" data-state={state}>
        {body}
      </p>
      <p className="text-xs text-faint">{companyLine(locale)}</p>
    </Card>
  );

  if (!AUTH_ID.test(authorizationId)) {
    return <Problem title={t("badRequestTitle")} body={t("badRequestBody")} state="bad_request" />;
  }

  // A real account, not a guest: a guest session cannot be signed into again,
  // so a token minted for one would stop working the moment they leave.
  const user = await getAuthUserCached();
  if (!user || user.is_anonymous) {
    const href = signInHref(locale, `/${locale}/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`);
    return (
      <Card>
        <h1 className="text-xl font-black tracking-tight text-heading">{t("signInTitle")}</h1>
        <p className="text-sm text-body">{t("signInBody")}</p>
        <Link href={href} className={button} data-testid="consent-sign-in">
          {t("signIn")}
        </Link>
        <p className="text-xs text-faint">{companyLine(locale)}</p>
      </Card>
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);

  if (error || !data) {
    // Either the OAuth server is not switched on for this project yet, or the
    // request has expired. Never a 500, and never a half-explained screen.
    console.warn("[oauth] authorization details unavailable:", error?.message);
    return <Problem title={t("notReadyTitle")} body={t("notReadyBody")} state="not_ready" />;
  }

  // Already consented: Supabase hands back the finished redirect.
  if (!("authorization_id" in data)) redirect(data.redirect_url);

  const clientName = data.client.name?.trim() || t("unknownClient");
  const redirectHost = (() => {
    try {
      return new URL(data.redirect_uri).host;
    } catch {
      return data.redirect_uri;
    }
  })();

  const hidden = (
    <>
      <input type="hidden" name="authorization_id" value={data.authorization_id} />
      <input type="hidden" name="locale" value={locale} />
    </>
  );

  return (
    <Card>
      <h1 className="flex items-center gap-2 text-xl font-black tracking-tight text-heading">
        <ShieldCheck className="h-5 w-5 text-cobalt" strokeWidth={1.5} aria-hidden />
        {t("title")}
      </h1>

      <p className="text-sm text-body">{t("intro", { client: clientName })}</p>

      <ul className="space-y-2 text-sm text-body">
        <li>• {t("canProject")}</li>
        <li>• {t("canCart")}</li>
        <li>• {t("canMeeting")}</li>
      </ul>

      <p className="text-sm font-semibold text-heading">{t("cannot")}</p>
      <p className="text-sm text-mutedtext">{t("privacy")}</p>

      <dl className="space-y-1 text-xs text-mutedtext">
        <div className="flex flex-wrap gap-1">
          <dt className="font-semibold">{t("account")}</dt>
          <dd dir="ltr">{data.user.email || user.email}</dd>
        </div>
        <div className="flex flex-wrap gap-1">
          <dt className="font-semibold">{t("sendsTo")}</dt>
          <dd dir="ltr">{redirectHost}</dd>
        </div>
      </dl>

      {failed && (
        <p className="text-sm font-medium text-destructive" data-testid="consent-error">
          {failed === "bad_request" ? t("badRequestBody") : t("failed")}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <form action={approveAction}>
          {hidden}
          <button type="submit" className={button} data-testid="consent-allow">
            {t("allow")}
          </button>
        </form>
        <form action={denyAction}>
          {hidden}
          <button type="submit" className={ghost} data-testid="consent-deny">
            {t("deny")}
          </button>
        </form>
      </div>

      <p className="text-xs text-faint">{companyLine(locale)}</p>
    </Card>
  );
}
