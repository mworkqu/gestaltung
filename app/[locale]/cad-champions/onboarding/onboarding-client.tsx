"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, ClipboardCheck, Cpu, FlaskConical, Gauge, GraduationCap, Laptop, Timer } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { Alert, Button, HelpTip, Stepper, Term, type StepperStep } from "@/components/cad-champions/ui";
import { TrackPicker } from "@/components/cad-champions/profile/track-picker";
import type { Locale } from "@/i18n/routing";
import { ONBOARDING_LAST_SCREEN } from "@/lib/cad-champions/profile/onboarding";
import type { CcTrack } from "@/lib/cad-champions/profile/track";
import { ccPath } from "@/lib/cad-champions/routes";

import { completeOnboarding, saveOnboardingStep, skipOnboarding, type OnboardingResult } from "./actions";

const TOTAL = ONBOARDING_LAST_SCREEN + 1;

export function OnboardingClient({ startScreen, initialTrack }: { startScreen: number; initialTrack: CcTrack }) {
  const t = useTranslations("CC.onboarding");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [screen, setScreen] = React.useState(startScreen);
  const [track, setTrack] = React.useState<CcTrack>(initialTrack);
  const [busy, setBusy] = React.useState<"next" | "skip" | "finish" | null>(null);
  const [error, setError] = React.useState<"save" | "skip" | null>(null);
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  const firstRender = React.useRef(true);

  // Move focus to the new screen's heading so keyboard and screen-reader users land in the right place.
  React.useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [screen]);

  const isLast = screen === ONBOARDING_LAST_SCREEN;

  async function next() {
    setError(null);
    setBusy("next");
    const result: OnboardingResult = await saveOnboardingStep(screen + 1);
    setBusy(null);
    // A failed progress save must not block reading the next screen; it only means resume starts earlier.
    if (!result.ok && result.error === "session") {
      router.refresh();
      return;
    }
    setScreen((s) => Math.min(s + 1, ONBOARDING_LAST_SCREEN));
  }

  function back() {
    setError(null);
    setScreen((s) => Math.max(s - 1, 0));
  }

  async function skip() {
    setError(null);
    setBusy("skip");
    const result = await skipOnboarding();
    if (!result.ok) {
      console.error("[cc onboarding] skip failed", result.error);
      setBusy(null);
      setError("skip");
      return;
    }
    router.push(`${ccPath(locale, "/dashboard")}?skip=1`);
  }

  async function finish() {
    setError(null);
    setBusy("finish");
    const result = await completeOnboarding(track);
    if (!result.ok) {
      console.error("[cc onboarding] finish failed", result.error);
      setBusy(null);
      if (result.error === "session") router.refresh();
      else setError("save");
      return;
    }
    router.push(ccPath(locale, "/get-ready"));
  }

  const howSteps: StepperStep[] = [
    { id: "get-ready", label: t("how.getReadyLabel"), description: t("how.getReadyText"), status: "upcoming" },
    { id: "test", label: t("how.testLabel"), description: t("how.testText"), status: "upcoming" },
    { id: "results", label: t("how.resultsLabel"), description: t("how.resultsText"), status: "upcoming" },
    { id: "training", label: t("how.trainingLabel"), description: t("how.trainingText"), status: "upcoming" },
  ];

  return (
    <div className="mt-8 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm font-semibold text-body" aria-live="polite">
          {t("progress", { current: screen + 1, total: TOTAL })}
        </p>
        <div aria-hidden="true" className="flex items-center gap-2">
          {Array.from({ length: TOTAL }, (_, i) => (
            <span key={i} className={`h-2 w-8 rounded-full ${i <= screen ? "bg-accent" : "bg-panel"}`} />
          ))}
        </div>
      </div>

      <section className="neu space-y-6 p-6 sm:p-8" aria-labelledby="cc-onboarding-heading">
        {screen === 0 ? (
          <>
            <h2 id="cc-onboarding-heading" ref={headingRef} tabIndex={-1} className="text-2xl font-extrabold text-heading focus:outline-none">
              {t("what.title")}
            </h2>
            <p className="max-w-2xl text-base text-body">{t("what.body")}</p>
            <ul className="grid gap-4 md:grid-cols-3">
              {(
                [
                  { icon: FlaskConical, title: "what.point1Title", text: "what.point1Text" },
                  { icon: Gauge, title: "what.point2Title", text: "what.point2Text" },
                  { icon: GraduationCap, title: "what.point3Title", text: "what.point3Text" },
                ] as const
              ).map(({ icon: Icon, title, text }) => (
                <li key={title} className="tile space-y-2">
                  <Icon aria-hidden="true" strokeWidth={1.75} className="h-6 w-6 text-accent" />
                  <p className="font-bold text-ink">{t(title)}</p>
                  <p className="text-sm text-body">{t(text)}</p>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        {screen === 1 ? (
          <>
            <div className="flex items-center gap-2">
              <h2 id="cc-onboarding-heading" ref={headingRef} tabIndex={-1} className="text-2xl font-extrabold text-heading focus:outline-none">
                {t("how.title")}
              </h2>
              <HelpTip label={t("how.testHelpLabel")}>{t("how.testHelp")}</HelpTip>
            </div>
            <p className="max-w-2xl text-base text-body">{t("how.intro")}</p>
            <Stepper steps={howSteps} />
          </>
        ) : null}

        {screen === 2 ? (
          <>
            <h2 id="cc-onboarding-heading" ref={headingRef} tabIndex={-1} className="text-2xl font-extrabold text-heading focus:outline-none">
              {t("before.title")}
            </h2>
            <p className="max-w-2xl text-base text-body">{t("before.intro")}</p>
            <ul className="grid gap-4 md:grid-cols-3">
              <li className="tile space-y-2">
                <Laptop aria-hidden="true" strokeWidth={1.75} className="h-6 w-6 text-accent" />
                <p className="font-bold text-ink">{t("before.computerTitle")}</p>
                <p className="text-sm text-body">{t("before.computerText")}</p>
              </li>
              <li className="tile space-y-2">
                <Cpu aria-hidden="true" strokeWidth={1.75} className="h-6 w-6 text-accent" />
                <p className="font-bold text-ink">{t("before.softwareTitle")}</p>
                <p className="text-sm text-body">
                  {t.rich("before.softwareText", { step: (chunks) => <Term id="step-file">{chunks}</Term> })}
                </p>
              </li>
              <li className="tile space-y-2">
                <Timer aria-hidden="true" strokeWidth={1.75} className="h-6 w-6 text-accent" />
                <p className="font-bold text-ink">{t("before.timeTitle")}</p>
                <p className="text-sm text-body">{t("before.timeText")}</p>
              </li>
            </ul>
            <p className="flex items-start gap-2 text-sm font-semibold text-ink">
              <ClipboardCheck aria-hidden="true" strokeWidth={1.75} className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
              {t("before.guide")}
            </p>
          </>
        ) : null}

        {screen === 3 ? (
          <>
            <h2 id="cc-onboarding-heading" ref={headingRef} tabIndex={-1} className="text-2xl font-extrabold text-heading focus:outline-none">
              {t("software.title")}
            </h2>
            <p className="max-w-2xl text-base text-body">{t("software.intro")}</p>
            <TrackPicker value={track} onChange={setTrack} disabled={busy !== null} />
            <p className="text-sm text-body">{t("software.switchNote")}</p>
          </>
        ) : null}

        {error ? (
          <Alert tone="error" title={t(error === "save" ? "errors.saveTitle" : "errors.skipTitle")}>
            {t(error === "save" ? "errors.saveBody" : "errors.skipBody")}
          </Alert>
        ) : null}

        <div className="flex flex-col-reverse gap-3 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col items-start gap-1">
            <Button variant="ghost" onClick={skip} loading={busy === "skip"} loadingText={t("saving")} disabled={busy !== null}>
              {t("skip")}
            </Button>
            <span className="px-4 text-xs text-body">{t("skipHelp")}</span>
          </div>
          <div className="flex flex-col-reverse gap-3 sm:flex-row">
            {screen > 0 ? (
              <Button variant="secondary" onClick={back} disabled={busy !== null}>
                <ArrowLeft aria-hidden="true" strokeWidth={1.75} className="h-4 w-4 rtl:-scale-x-100" />
                {t("back")}
              </Button>
            ) : null}
            {isLast ? (
              <Button onClick={finish} loading={busy === "finish"} loadingText={t("saving")} disabled={busy !== null && busy !== "finish"}>
                {t("goToGetReady")}
                <ArrowRight aria-hidden="true" strokeWidth={1.75} className="h-4 w-4 rtl:-scale-x-100" />
              </Button>
            ) : (
              <Button onClick={next} loading={busy === "next"} loadingText={t("saving")} disabled={busy !== null && busy !== "next"}>
                {t("next")}
                <ArrowRight aria-hidden="true" strokeWidth={1.75} className="h-4 w-4 rtl:-scale-x-100" />
              </Button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

