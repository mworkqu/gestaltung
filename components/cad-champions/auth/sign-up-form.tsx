"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { Alert, Button, Card, useToast } from "@/components/cad-champions/ui";
import { Turnstile, turnstileActive } from "@/components/turnstile";
import type { Locale } from "@/i18n/routing";
import { CC_PENDING_EMAIL_KEY, ccSignInHref } from "@/lib/cad-champions/auth/paths";
import {
  CC_CAD_EXPERIENCE,
  CC_CAD_SOFTWARE_USED,
  CC_COMPUTER_ACCESS,
  CC_INSTITUTIONS,
  CC_STUDY_LEVELS,
  checkProfile,
  checkSignUp,
  isMinorDob,
  qatarToday,
} from "@/lib/cad-champions/auth/schema";
import { Ltr } from "@/lib/cad-champions/ltr";
import { ccPath } from "@/lib/cad-champions/routes";
import { createCcProfile, ccSignUp } from "@/app/[locale]/cad-champions/sign-up/actions";
import { cn } from "@/lib/utils";

import { Field, PasswordField, ccFieldClass, describedBy } from "./fields";
import { useAuthErrorText } from "./use-auth-error";

type Values = {
  email: string;
  password: string;
  fullName: string;
  phone: string;
  institution: string;
  institutionOther: string;
  studyLevel: string;
  dateOfBirth: string;
  guardianName: string;
  guardianPhone: string;
  guardianConsent: boolean;
  cadSoftwareUsed: string;
  cadExperience: string;
  hasWindowsPc: string;
  marketingConsent: boolean;
};

const EMPTY: Values = {
  email: "",
  password: "",
  fullName: "",
  phone: "",
  institution: "",
  institutionOther: "",
  studyLevel: "",
  dateOfBirth: "",
  guardianName: "",
  guardianPhone: "",
  guardianConsent: false,
  cadSoftwareUsed: "",
  cadExperience: "",
  hasWindowsPc: "",
  marketingConsent: false,
};

/** Order used to focus the first field with an error. */
const FIELD_ORDER: (keyof Values)[] = [
  "fullName",
  "email",
  "password",
  "phone",
  "institution",
  "institutionOther",
  "studyLevel",
  "dateOfBirth",
  "guardianName",
  "guardianPhone",
  "guardianConsent",
  "cadSoftwareUsed",
  "cadExperience",
  "hasWindowsPc",
];

export function CcSignUpForm({
  locale,
  mode,
  next,
  turnstileEnabled = false,
  signedInEmail,
}: {
  locale: Locale;
  /** "signUp" = new account; "complete" = signed in already, profile only. */
  mode: "signUp" | "complete";
  next: string | null;
  turnstileEnabled?: boolean;
  signedInEmail?: string | null;
}) {
  const t = useTranslations("CC.auth");
  const errorText = useAuthErrorText();
  const toast = useToast();
  const router = useRouter();

  const [v, setV] = React.useState<Values>(EMPTY);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<{ code: string; retry?: number } | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [captcha, setCaptcha] = React.useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = React.useState(0);
  const alertRef = React.useRef<HTMLDivElement>(null);

  const minor = isMinorDob(v.dateOfBirth);
  const today = React.useMemo(() => qatarToday(), []);
  const needsCaptcha = mode === "signUp" && turnstileActive(turnstileEnabled);

  const set = <K extends keyof Values>(key: K, value: Values[K]) => {
    setV((old) => ({ ...old, [key]: value }));
    if (errors[key]) setErrors((old) => ({ ...old, [key]: "" }));
  };

  const err = (key: keyof Values) => (errors[key] ? errorText(errors[key]) : undefined);

  function profilePayload() {
    return {
      fullName: v.fullName,
      phone: v.phone,
      institution: v.institution,
      institutionOther: v.institutionOther,
      studyLevel: v.studyLevel,
      dateOfBirth: v.dateOfBirth,
      guardianName: v.guardianName,
      guardianPhone: v.guardianPhone,
      guardianConsent: v.guardianConsent,
      cadSoftwareUsed: v.cadSoftwareUsed,
      cadExperience: v.cadExperience,
      hasWindowsPc: v.hasWindowsPc,
      marketingConsent: v.marketingConsent,
    };
  }

  function showErrors(found: Record<string, string>) {
    setErrors(found);
    setFormError({ code: "fixErrors" });
    const first = FIELD_ORDER.find((k) => found[k]);
    if (first) window.setTimeout(() => document.getElementById(`cc-${first}`)?.focus(), 0);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (loading) return;
    setFormError(null);

    const profile = profilePayload();
    const payload = { email: v.email.trim(), password: v.password, captchaToken: captcha, next, profile };
    const check = mode === "signUp" ? checkSignUp(payload) : checkProfile(profile);
    if (!check.ok) {
      showErrors(check.errors);
      return;
    }
    if (needsCaptcha && !captcha) {
      setFormError({ code: "captchaRequired" });
      return;
    }

    setLoading(true);
    try {
      if (mode === "complete") {
        const res = await createCcProfile(locale, profile, next);
        if (res.ok) {
          toast.success(t("signUp.successTitle"), t("signUp.successBody"));
          window.location.assign(res.redirectTo);
          return;
        }
        if (res.fieldErrors) showErrors(res.fieldErrors);
        else setFormError({ code: res.error ?? "unknown" });
        return;
      }

      const res = await ccSignUp(locale, payload);
      if (captcha) {
        setCaptcha(null);
        setCaptchaReset((k) => k + 1);
      }
      if (res.ok && res.status === "signedIn") {
        toast.success(t("signUp.successTitle"), t("signUp.successBody"));
        window.location.assign(res.redirectTo);
        return;
      }
      if (res.ok && res.status === "checkEmail") {
        try {
          window.sessionStorage.setItem(CC_PENDING_EMAIL_KEY, payload.email);
        } catch {
          // Storage blocked: the check-email screen says "the address you entered".
        }
        router.push(ccPath(locale, "/check-email"));
        return;
      }
      if (!res.ok) {
        if (res.fieldErrors) showErrors(res.fieldErrors);
        else setFormError({ code: res.error ?? "unknown", retry: res.retryAfterSec });
      }
    } catch (error) {
      console.error("[cc-sign-up] request failed", error);
      setFormError({ code: "network" });
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    if (formError && formError.code !== "fixErrors") alertRef.current?.focus();
  }, [formError]);

  const select = (key: keyof Values, options: readonly string[], list: string, labelKey: string, why?: string) => (
    <Field id={`cc-${key}`} label={t(labelKey)} why={why} error={err(key)}>
      <select
        id={`cc-${key}`}
        name={key}
        required
        value={v[key] as string}
        onChange={(e) => set(key, e.target.value as never)}
        className={cn(ccFieldClass, "appearance-auto")}
        {...describedBy(`cc-${key}`, { error: err(key) })}
      >
        <option value="" disabled>
          {t("signUp.choose")}
        </option>
        {options.map((o) => (
          <option key={o} value={o}>
            {t(`options.${list}.${o}`)}
          </option>
        ))}
      </select>
    </Field>
  );

  const sectionTitle = "text-lg font-bold text-heading";

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-6">
      {formError ? (
        <div ref={alertRef} tabIndex={-1} className="focus:outline-none">
          {formError.code === "fixErrors" ? (
            <Alert tone="error" title={t("signUp.fixErrors")}>
              {t("signUp.fixErrorsBody")}
            </Alert>
          ) : (
            <Alert
              tone="error"
              title={t("errors.errorTitle")}
              action={
                formError.code === "userExists" ? (
                  <Link href={ccSignInHref(locale, next)} className="inline-flex min-h-11 items-center font-semibold text-accent underline-offset-4 hover:underline">
                    {t("signUp.signInLink")}
                  </Link>
                ) : undefined
              }
            >
              {errorText(formError.code, formError.retry)}
            </Alert>
          )}
        </div>
      ) : null}

      <Card className="space-y-5">
        <h2 className={sectionTitle}>{mode === "signUp" ? t("signUp.accountHeading") : t("signUp.aboutHeading")}</h2>
        {mode === "complete" && signedInEmail ? (
          <p className="text-sm text-body">
            {t("signUp.completeSignedInAs")} <Ltr className="font-semibold text-heading">{signedInEmail}</Ltr>
          </p>
        ) : null}

        <Field id="cc-fullName" label={t("signUp.fullName")} why={t("signUp.fullNameWhy")} error={err("fullName")}>
          <input
            id="cc-fullName"
            name="fullName"
            type="text"
            required
            autoComplete="name"
            maxLength={120}
            placeholder={t("signUp.fullNamePlaceholder")}
            value={v.fullName}
            onChange={(e) => set("fullName", e.target.value)}
            className={ccFieldClass}
            {...describedBy("cc-fullName", { error: err("fullName") })}
          />
        </Field>

        {mode === "signUp" ? (
          <>
            <Field id="cc-email" label={t("common.email")} why={t("signUp.emailWhy")} error={err("email")}>
              <input
                id="cc-email"
                name="email"
                type="email"
                required
                autoComplete="email"
                inputMode="email"
                dir="ltr"
                maxLength={254}
                placeholder={t("common.emailPlaceholder")}
                value={v.email}
                onChange={(e) => set("email", e.target.value)}
                className={cn(ccFieldClass, "text-start")}
                {...describedBy("cc-email", { error: err("email") })}
              />
            </Field>
            <PasswordField
              id="cc-password"
              name="password"
              label={t("common.password")}
              why={t("signUp.passwordWhy")}
              value={v.password}
              onChange={(val) => set("password", val)}
              error={err("password")}
              autoComplete="new-password"
              showRules
            />
          </>
        ) : null}

        <Field id="cc-phone" label={t("signUp.phone")} why={t("signUp.phoneWhy")} hint={t("signUp.phoneHint")} error={err("phone")}>
          <input
            id="cc-phone"
            name="phone"
            type="tel"
            required
            autoComplete="tel"
            inputMode="tel"
            dir="ltr"
            maxLength={24}
            placeholder={t("signUp.phonePlaceholder")}
            value={v.phone}
            onChange={(e) => set("phone", e.target.value)}
            className={cn(ccFieldClass, "text-start")}
            {...describedBy("cc-phone", { hint: t("signUp.phoneHint"), error: err("phone") })}
          />
        </Field>
      </Card>

      <Card className="space-y-5">
        <h2 className={sectionTitle}>{mode === "signUp" ? t("signUp.aboutHeading") : t("signUp.cadHeading")}</h2>
        {select("institution", CC_INSTITUTIONS, "institution", "signUp.institution", t("signUp.institutionWhy"))}
        {v.institution === "other" ? (
          <Field id="cc-institutionOther" label={t("signUp.institutionOther")} error={err("institutionOther")}>
            <input
              id="cc-institutionOther"
              name="institutionOther"
              type="text"
              required
              maxLength={160}
              value={v.institutionOther}
              onChange={(e) => set("institutionOther", e.target.value)}
              className={ccFieldClass}
              {...describedBy("cc-institutionOther", { error: err("institutionOther") })}
            />
          </Field>
        ) : null}
        {select("studyLevel", CC_STUDY_LEVELS, "studyLevel", "signUp.studyLevel", t("signUp.studyLevelWhy"))}

        <Field id="cc-dateOfBirth" label={t("signUp.dateOfBirth")} why={t("signUp.dateOfBirthWhy")} error={err("dateOfBirth")}>
          <input
            id="cc-dateOfBirth"
            name="dateOfBirth"
            type="date"
            required
            autoComplete="bday"
            dir="ltr"
            max={today}
            min="1920-01-01"
            value={v.dateOfBirth}
            onChange={(e) => set("dateOfBirth", e.target.value)}
            className={cn(ccFieldClass, "text-start")}
            {...describedBy("cc-dateOfBirth", { error: err("dateOfBirth") })}
          />
        </Field>

        {minor ? (
          <div className="space-y-5 rounded-2xl border border-inventory/20 bg-inventory-bg p-4 sm:p-5" aria-live="polite">
            <div>
              <p className="text-sm font-bold text-ink">{t("signUp.minorTitle")}</p>
              <p className="mt-1 text-sm text-body">{t("signUp.minorBody")}</p>
            </div>
            <Field id="cc-guardianName" label={t("signUp.guardianName")} error={err("guardianName")}>
              <input
                id="cc-guardianName"
                name="guardianName"
                type="text"
                required
                maxLength={120}
                value={v.guardianName}
                onChange={(e) => set("guardianName", e.target.value)}
                className={ccFieldClass}
                {...describedBy("cc-guardianName", { error: err("guardianName") })}
              />
            </Field>
            <Field id="cc-guardianPhone" label={t("signUp.guardianPhone")} why={t("signUp.guardianPhoneWhy")} error={err("guardianPhone")}>
              <input
                id="cc-guardianPhone"
                name="guardianPhone"
                type="tel"
                required
                inputMode="tel"
                dir="ltr"
                maxLength={24}
                placeholder={t("signUp.phonePlaceholder")}
                value={v.guardianPhone}
                onChange={(e) => set("guardianPhone", e.target.value)}
                className={cn(ccFieldClass, "text-start")}
                {...describedBy("cc-guardianPhone", { error: err("guardianPhone") })}
              />
            </Field>
            <div>
              <label htmlFor="cc-guardianConsent" className="flex min-h-11 cursor-pointer items-start gap-3 text-sm text-body">
                <input
                  id="cc-guardianConsent"
                  name="guardianConsent"
                  type="checkbox"
                  checked={v.guardianConsent}
                  onChange={(e) => set("guardianConsent", e.target.checked)}
                  className="mt-0.5 h-5 w-5 shrink-0 accent-accent"
                  {...describedBy("cc-guardianConsent", { error: err("guardianConsent") })}
                />
                <span>{t("signUp.guardianConsent")}</span>
              </label>
              {err("guardianConsent") ? (
                <p id="cc-guardianConsent-error" className="mt-1.5 text-sm font-medium text-[#a1231f]">
                  {err("guardianConsent")}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
      </Card>

      <Card className="space-y-5">
        <h2 className={sectionTitle}>{t("signUp.cadHeading")}</h2>
        {select("cadSoftwareUsed", CC_CAD_SOFTWARE_USED, "cadSoftware", "signUp.cadSoftware", t("signUp.cadSoftwareWhy"))}
        {select("cadExperience", CC_CAD_EXPERIENCE, "cadExperience", "signUp.cadExperience", t("signUp.cadExperienceWhy"))}
        {select("hasWindowsPc", CC_COMPUTER_ACCESS, "computer", "signUp.computer", t("signUp.computerWhy"))}

        <label htmlFor="cc-marketing" className="flex min-h-11 cursor-pointer items-start gap-3 text-sm text-body">
          <input
            id="cc-marketing"
            name="marketingConsent"
            type="checkbox"
            checked={v.marketingConsent}
            onChange={(e) => set("marketingConsent", e.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0 accent-accent"
          />
          <span>{t("signUp.marketing")}</span>
        </label>
      </Card>

      {mode === "signUp" ? (
        <Turnstile enabled={turnstileEnabled} onToken={setCaptcha} resetKey={captchaReset} action="cc_sign_up" />
      ) : null}

      <p className="text-sm text-body">
        {t.rich("signUp.legal", {
          terms: (chunks) => (
            <Link href={ccPath(locale, "/terms")} className="font-semibold text-accent underline-offset-4 hover:underline">
              {chunks}
            </Link>
          ),
          privacy: (chunks) => (
            <Link href={ccPath(locale, "/privacy")} className="font-semibold text-accent underline-offset-4 hover:underline">
              {chunks}
            </Link>
          ),
        })}
      </p>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <Button
          type="submit"
          loading={loading}
          loadingText={mode === "signUp" ? t("signUp.submitting") : t("signUp.completeSubmitting")}
          className="w-full sm:w-auto"
        >
          {mode === "signUp" ? t("signUp.submit") : t("signUp.completeSubmit")}
        </Button>
        {mode === "signUp" ? (
          <p className="text-sm text-body">
            {t("signUp.haveAccount")}{" "}
            <Link href={ccSignInHref(locale, next)} className="inline-flex min-h-11 items-center font-semibold text-accent underline-offset-4 hover:underline">
              {t("signUp.signInLink")}
            </Link>
          </p>
        ) : null}
      </div>
    </form>
  );
}
