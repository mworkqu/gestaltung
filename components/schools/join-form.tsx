"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";

import { Turnstile, turnstileActive } from "@/components/turnstile";
import { Button } from "@/components/ui/button";
import { Link, useRouter } from "@/i18n/navigation";
import {
  TEAM_NAME_MAX,
  isJoinCodeShape,
  isTeamNameValid,
  normalizeJoinCode,
  normalizeTeamName,
} from "@/lib/schools/join-code";
import { createClient } from "@/lib/supabase/client";
import { ensureSession, getCurrentUser } from "@/lib/supabase/guest";

type ErrKey = "errCode" | "errBadCode" | "errTeam" | "errFull" | "errFailed" | "errRunMigration";

const INPUT =
  "w-full min-h-11 rounded-xl border border-white/60 bg-panel px-4 py-3 text-base text-heading shadow-neu-inset outline-none placeholder:text-faint focus:ring-2 focus:ring-cobalt/60";

function errorKey(err: unknown): ErrKey {
  const e = err as { code?: string; message?: string } | null;
  const message = (e?.message ?? "").toLowerCase();
  if (e?.code === "PGRST202" || e?.code === "42883" || message.includes("could not find the function")) {
    return "errRunMigration";
  }
  if (message.includes("bad_team_name")) return "errTeam";
  if (message.includes("bad_code")) return "errBadCode";
  if (message.includes("class_full")) return "errFull";
  // "sign_in" and anything unknown.
  return "errFailed";
}

export function JoinForm({ turnstileEnabled = false }: { turnstileEnabled?: boolean }) {
  const t = useTranslations("SchoolJoin");
  const safety = useTranslations("SchoolSafety");
  const router = useRouter();

  const [code, setCode] = useState("");
  const [team, setTeam] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrKey | null>(null);
  const [needsCheck, setNeedsCheck] = useState(false);
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);

  // The class sheet links to /ar/join?code=BK7TQ2. Read in the browser so the
  // page itself stays static (same approach as components/contact-form.tsx).
  useEffect(() => {
    try {
      const raw = new URLSearchParams(window.location.search).get("code");
      if (raw) setCode(normalizeJoinCode(raw));
    } catch {
      /* no prefill */
    }
  }, []);

  // Only a student without a session needs the check (it guards signInAnonymously).
  useEffect(() => {
    if (!turnstileActive(turnstileEnabled)) return;
    void getCurrentUser().then((u) => setNeedsCheck(!u));
  }, [turnstileEnabled]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!isJoinCodeShape(code)) {
      setError("errCode");
      return;
    }
    if (!isTeamNameValid(team)) {
      setError("errTeam");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      try {
        await ensureSession({ captchaToken: captcha });
      } finally {
        // Single-use token: a retry needs a fresh one.
        if (captcha) setCaptchaReset((k) => k + 1);
      }
      const { data, error: rpcError } = await createClient().rpc("join_class_team", {
        p_code: normalizeJoinCode(code),
        p_team_name: normalizeTeamName(team),
      });
      if (rpcError) throw rpcError;
      const projectId = (data as { project_id?: string } | null)?.project_id;
      if (!projectId) throw new Error("no project");
      router.push(`/projects/${projectId}/studio`);
    } catch (err) {
      setError(errorKey(err));
      setBusy(false);
    }
  }

  return (
    <section className="neu animate-fade-up flex flex-col gap-5 hero-pad">
      <span className="inline-flex w-fit items-center gap-2 rounded-full bg-panel px-3 py-1.5 shadow-neu-sm">
        <span className="h-2 w-2 rounded-full bg-cobalt" />
        <span className="kicker text-mutedtext">{safety("banner")}</span>
      </span>
      <h1 className="max-w-3xl text-balance title-page">{t("heading")}</h1>
      <p className="max-w-2xl text-base leading-relaxed text-body sm:text-lg">{t("sub")}</p>

      <form onSubmit={onSubmit} noValidate className="flex w-full max-w-xl flex-col gap-5">
        <div className="space-y-2">
          <label htmlFor="join-code" className="block text-sm font-medium text-heading">
            {t("codeLabel")}
          </label>
          <input
            id="join-code"
            name="code"
            type="text"
            dir="ltr"
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            maxLength={6}
            value={code}
            onChange={(e) => setCode(normalizeJoinCode(e.target.value))}
            placeholder={t("codePlaceholder")}
            aria-describedby="join-code-help"
            className={`${INPUT} text-start font-mono uppercase tracking-[0.3em]`}
          />
          <p id="join-code-help" className="text-sm text-mutedtext">
            {t("codeHelp")}
          </p>
        </div>

        <div className="space-y-2">
          <label htmlFor="join-team" className="block text-sm font-medium text-heading">
            {t("teamLabel")}
          </label>
          <input
            id="join-team"
            name="team"
            type="text"
            autoComplete="off"
            maxLength={TEAM_NAME_MAX}
            value={team}
            onChange={(e) => setTeam(e.target.value)}
            placeholder={t("teamPlaceholder")}
            aria-describedby="join-team-help"
            className={INPUT}
          />
          <p id="join-team-help" className="text-sm text-mutedtext">
            {t("teamHelp")}
          </p>
        </div>

        {needsCheck && (
          <Turnstile enabled={turnstileEnabled} onToken={setCaptcha} resetKey={captchaReset} action="join_class" />
        )}

        {error && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {t(error)}
          </p>
        )}

        <Button type="submit" size="lg" disabled={busy} className="min-h-11 w-full rounded-full sm:w-auto">
          {busy ? t("joining") : t("join")}
        </Button>

        <p className="text-sm text-mutedtext">{t("privacy")}</p>
      </form>

      <Link
        href="/schools"
        className="inline-flex min-h-11 w-fit items-center text-sm font-semibold text-cobalt hover:text-cobalt-hover"
      >
        {t("teacherLink")}
      </Link>
    </section>
  );
}
