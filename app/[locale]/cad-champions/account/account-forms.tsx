"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, Eye, EyeOff, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { TrackPicker } from "@/components/cad-champions/profile/track-picker";
import { Alert, Button, ConfirmDialog, HelpTip, useToast } from "@/components/cad-champions/ui";
import type { Locale } from "@/i18n/routing";
import {
  CC_CAD_EXPERIENCE,
  CC_CAD_SOFTWARE_USED,
  CC_COMPUTER_ACCESS,
  CC_STUDY_LEVELS,
} from "@/lib/cad-champions/db/types";
import { formatDate } from "@/lib/cad-champions/format";
import { checkPassword, isPasswordValid } from "@/lib/cad-champions/profile/password";
import type { CcTrack } from "@/lib/cad-champions/profile/track";
import { ccPath } from "@/lib/cad-champions/routes";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

import {
  cancelAccountDeletion,
  requestAccountDeletion,
  saveDetails,
  saveEmailPrefs,
  saveLanguage,
  saveTrack,
  type AccountError,
  type AccountResult,
} from "./actions";

// ------------------------------------------------------------ shared bits

const fieldClass =
  "neu-inset min-h-[44px] w-full rounded-xl border border-transparent bg-transparent px-4 py-2 text-base text-ink " +
  "placeholder:text-mutedtext focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60";

export function SectionCard({
  id,
  title,
  purpose,
  help,
  children,
}: {
  id: string;
  title: string;
  purpose: string;
  help?: { label: string; text: string };
  children: React.ReactNode;
}) {
  return (
    <section className="neu space-y-5 p-6 sm:p-8" aria-labelledby={`${id}-heading`}>
      <div>
        <div className="flex items-center gap-2">
          <h2 id={`${id}-heading`} className="text-xl font-extrabold text-heading">
            {title}
          </h2>
          {help ? <HelpTip label={help.label}>{help.text}</HelpTip> : null}
        </div>
        <p className="mt-1 max-w-2xl text-sm text-body">{purpose}</p>
      </div>
      {children}
    </section>
  );
}

function useErrorMessage() {
  const t = useTranslations("CC.account.errors");
  return React.useCallback(
    (code: AccountError): { title: string; body: string } => {
      switch (code) {
        case "session":
          return { title: t("sessionTitle"), body: t("sessionBody") };
        case "invalid":
          return { title: t("invalidTitle"), body: t("saveBody") };
        case "invalid_phone":
          return { title: t("invalidTitle"), body: t("phoneInvalid") };
        default:
          return { title: t("saveTitle"), body: t("saveBody") };
      }
    },
    [t],
  );
}

/** Runs a server action, shows the friendly Alert on failure and a toast on success. */
function useSave() {
  const toast = useToast();
  const router = useRouter();
  const describe = useErrorMessage();
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<{ title: string; body: string } | null>(null);

  const run = React.useCallback(
    async (action: () => Promise<AccountResult>, success: { title: string; text?: string }, onDone?: () => void) => {
      setPending(true);
      setError(null);
      try {
        const result = await action();
        if (result.ok) {
          toast.success(success.title, success.text);
          onDone?.();
        } else {
          setError(describe(result.error));
          if (result.error === "session") router.refresh();
        }
      } catch (e) {
        console.error("[cc account] action threw", e);
        setError(describe("save"));
      } finally {
        setPending(false);
      }
    },
    [describe, router, toast],
  );

  return { run, pending, error };
}

function ErrorAlert({ error }: { error: { title: string; body: string } | null }) {
  if (!error) return null;
  return (
    <Alert tone="error" title={error.title}>
      {error.body}
    </Alert>
  );
}

function Label({ htmlFor, children, help }: { htmlFor: string; children: React.ReactNode; help?: string }) {
  return (
    <div className="mb-1.5 flex items-center gap-1">
      <label htmlFor={htmlFor} className="text-sm font-semibold text-ink">
        {children}
      </label>
      {help ? <HelpTip label={String(children)}>{help}</HelpTip> : null}
    </div>
  );
}

// ---------------------------------------------------------------- details

export type DetailsValues = {
  fullName: string;
  fullNameAr: string;
  phone: string;
  studyLevel: string;
  cadSoftwareUsed: string;
  cadExperience: string;
  computer: string;
};

export function DetailsForm({ initial }: { initial: DetailsValues }) {
  const t = useTranslations("CC.account.details");
  const tOpt = useTranslations("CC.account.options");
  const { run, pending, error } = useSave();
  const [values, setValues] = React.useState(initial);
  const set = (key: keyof DetailsValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setValues((v) => ({ ...v, [key]: e.target.value }));

  const selects: { key: keyof DetailsValues; label: string; list: readonly string[]; ns: string }[] = [
    { key: "studyLevel", label: t("studyLevel"), list: CC_STUDY_LEVELS, ns: "studyLevel" },
    { key: "cadSoftwareUsed", label: t("cadSoftwareUsed"), list: CC_CAD_SOFTWARE_USED, ns: "cadSoftwareUsed" },
    { key: "cadExperience", label: t("cadExperience"), list: CC_CAD_EXPERIENCE, ns: "cadExperience" },
    { key: "computer", label: t("computer"), list: CC_COMPUTER_ACCESS, ns: "computer" },
  ];

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => saveDetails(values), { title: t("saved"), text: t("savedText") });
      }}
    >
      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <Label htmlFor="cc-full-name">{t("fullName")}</Label>
          <input id="cc-full-name" className={fieldClass} value={values.fullName} onChange={set("fullName")} autoComplete="name" required minLength={2} maxLength={100} />
        </div>
        <div>
          <Label htmlFor="cc-full-name-ar" help={t("fullNameHelp")}>
            {t("fullNameAr")}
          </Label>
          <input id="cc-full-name-ar" dir="rtl" className={fieldClass} value={values.fullNameAr} onChange={set("fullNameAr")} maxLength={100} />
        </div>
        <div>
          <Label htmlFor="cc-phone" help={t("phoneHelp")}>
            {t("phone")}
          </Label>
          <input id="cc-phone" dir="ltr" className={cn(fieldClass, "text-start")} value={values.phone} onChange={set("phone")} type="tel" autoComplete="tel" inputMode="tel" />
        </div>
        {selects.map(({ key, label, list, ns }) => (
          <div key={key}>
            <Label htmlFor={`cc-${key}`}>{label}</Label>
            <select id={`cc-${key}`} className={fieldClass} value={values[key]} onChange={set(key)}>
              <option value="">{t("notSet")}</option>
              {list.map((option) => (
                <option key={option} value={option}>
                  {tOpt(`${ns}.${option}`)}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
      <ErrorAlert error={error} />
      <Button type="submit" loading={pending} loadingText={t("saving")}>
        {t("save")}
      </Button>
    </form>
  );
}

// --------------------------------------------------------------- language

export function LanguageForm({ initial }: { initial: Locale }) {
  const t = useTranslations("CC.account.language");
  const router = useRouter();
  const { run, pending, error } = useSave();
  const [value, setValue] = React.useState<Locale>(initial);

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        void run(
          () => saveLanguage(value),
          { title: t("saved") },
          () => {
            // Same page in the chosen language (the server action also set the cc_locale cookie).
            router.push(ccPath(value, "/account"));
            router.refresh();
          },
        );
      }}
    >
      <div role="radiogroup" aria-label={t("groupLabel")} className="grid gap-3 sm:grid-cols-2">
        {(["en", "ar"] as const).map((code) => (
          <label
            key={code}
            className={cn(
              "neu flex min-h-[44px] cursor-pointer items-center gap-3 px-4 py-3 focus-within:ring-2 focus-within:ring-accent",
              value === code && "border-accent ring-1 ring-accent",
            )}
          >
            <input type="radio" name="locale" value={code} checked={value === code} onChange={() => setValue(code)} className="h-4 w-4 accent-accent" />
            <span lang={code} dir={code === "ar" ? "rtl" : "ltr"} className="font-semibold text-ink">
              {t(code)}
            </span>
          </label>
        ))}
      </div>
      <ErrorAlert error={error} />
      <Button type="submit" loading={pending} loadingText={t("save")}>
        {t("save")}
      </Button>
    </form>
  );
}

// ------------------------------------------------------------------ track

export function TrackForm({ initial }: { initial: CcTrack }) {
  const t = useTranslations("CC.account.track");
  const { run, pending, error } = useSave();
  const [value, setValue] = React.useState<CcTrack>(initial);

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => saveTrack(value), { title: t("saved"), text: t("savedText") });
      }}
    >
      <TrackPicker value={value} onChange={setValue} name="account-track" disabled={pending} />
      <ErrorAlert error={error} />
      <Button type="submit" loading={pending} loadingText={t("save")}>
        {t("save")}
      </Button>
    </form>
  );
}

// ------------------------------------------------------------------ email

export function EmailForm({ initial }: { initial: { weekly: boolean; marketing: boolean } }) {
  const t = useTranslations("CC.account.email");
  const { run, pending, error } = useSave();
  const [weekly, setWeekly] = React.useState(initial.weekly);
  const [marketing, setMarketing] = React.useState(initial.marketing);

  const toggle = (id: string, label: string, hint: string, checked: boolean, onChange: (v: boolean) => void) => (
    <label htmlFor={id} className="flex min-h-[44px] cursor-pointer items-start gap-3">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-accent" />
      <span>
        <span className="block text-sm font-semibold text-ink">{label}</span>
        <span className="block text-sm text-body">{hint}</span>
      </span>
    </label>
  );

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => saveEmailPrefs({ weeklyProgressEmail: weekly, marketingConsent: marketing }), { title: t("saved") });
      }}
    >
      {toggle("cc-pref-weekly", t("weeklyLabel"), t("weeklyHint"), weekly, setWeekly)}
      {toggle("cc-pref-marketing", t("marketingLabel"), t("marketingHint"), marketing, setMarketing)}
      <ErrorAlert error={error} />
      <Button type="submit" loading={pending} loadingText={t("save")}>
        {t("save")}
      </Button>
    </form>
  );
}

// --------------------------------------------------------------- password

export function PasswordForm() {
  const t = useTranslations("CC.account.password");
  const toast = useToast();
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [show, setShow] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const rules = checkPassword(password);
  const match = password.length > 0 && password === confirm;
  const valid = isPasswordValid(password) && match;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setPending(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        console.error("[cc account] password update failed", updateError.message);
        const code = (updateError as { code?: string }).code ?? "";
        if (code === "same_password") setError(t("errorSame"));
        else if (code === "reauthentication_needed") setError(t("errorRecent"));
        else setError(t("errorGeneric"));
        return;
      }
      toast.success(t("saved"), t("savedText"));
      setPassword("");
      setConfirm("");
    } catch (err) {
      console.error("[cc account] password update threw", err);
      setError(t("errorGeneric"));
    } finally {
      setPending(false);
    }
  }

  const rule = (ok: boolean, label: string) => (
    <li key={label} className={cn("flex items-center gap-2 text-sm", ok ? "text-buy" : "text-body")}>
      {ok ? <Check aria-hidden="true" strokeWidth={2} className="h-4 w-4" /> : <X aria-hidden="true" strokeWidth={2} className="h-4 w-4" />}
      <span>{label}</span>
    </li>
  );

  return (
    <form className="space-y-5" onSubmit={submit}>
      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <Label htmlFor="cc-new-password">{t("newLabel")}</Label>
          <div className="relative">
            <input
              id="cc-new-password"
              dir="ltr"
              type={show ? "text" : "password"}
              autoComplete="new-password"
              className={cn(fieldClass, "pe-12 text-start")}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-describedby="cc-password-rules"
            />
            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              aria-label={show ? t("hide") : t("show")}
              aria-pressed={show}
              className="absolute end-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full text-body hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {show ? <EyeOff aria-hidden="true" strokeWidth={1.75} className="h-5 w-5" /> : <Eye aria-hidden="true" strokeWidth={1.75} className="h-5 w-5" />}
            </button>
          </div>
        </div>
        <div>
          <Label htmlFor="cc-confirm-password">{t("confirmLabel")}</Label>
          <input
            id="cc-confirm-password"
            dir="ltr"
            type={show ? "text" : "password"}
            autoComplete="new-password"
            className={cn(fieldClass, "text-start")}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>
      </div>
      <ul id="cc-password-rules" aria-label={t("rulesLabel")} aria-live="polite" className="space-y-1">
        {rule(rules.length, t("ruleLength"))}
        {rule(rules.number, t("ruleNumber"))}
        {rule(match, t("ruleMatch"))}
      </ul>
      {error ? (
        <Alert tone="error" title={t("errorTitle")}>
          {error}
        </Alert>
      ) : null}
      <Button type="submit" loading={pending} loadingText={t("save")} disabled={!valid}>
        {t("save")}
      </Button>
    </form>
  );
}

// --------------------------------------------------------------- deletion

export function DeletionSection({ pendingSince }: { pendingSince: string | null }) {
  const t = useTranslations("CC.account.deletion");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(false);

  async function request() {
    setError(false);
    let result: AccountResult;
    try {
      result = await requestAccountDeletion();
    } catch (e) {
      console.error("[cc account] deletion request threw", e);
      result = { ok: false, error: "save" };
    }
    if (result.ok) {
      setOpen(false);
      toast.success(t("requested"), t("requestedText"));
      router.refresh();
    } else {
      setOpen(false);
      setError(true);
      if (result.error === "session") router.refresh();
    }
  }

  async function cancel() {
    setBusy(true);
    setError(false);
    try {
      const result = await cancelAccountDeletion();
      if (result.ok) {
        toast.success(t("cancelled"), t("cancelledText"));
        router.refresh();
      } else {
        setError(true);
        if (result.error === "session") router.refresh();
      }
    } catch (e) {
      console.error("[cc account] cancel deletion threw", e);
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      {pendingSince ? (
        <Alert
          tone="warning"
          title={t("pendingTitle")}
          action={
            <Button variant="secondary" size="sm" onClick={cancel} loading={busy} loadingText={t("cancelButton")}>
              {t("cancelButton")}
            </Button>
          }
        >
          {t("pendingBody", { date: formatDate(pendingSince, locale) })}
        </Alert>
      ) : (
        <>
          <p className="max-w-2xl text-sm text-body">{t("whatGoes")}</p>
          <p className="max-w-2xl text-sm text-body">{t("retention")}</p>
          <Button variant="danger" onClick={() => setOpen(true)}>
            {t("button")}
          </Button>
        </>
      )}
      {error ? (
        <Alert tone="error" title={t("errorTitle")}>
          {t("errorBody")}
        </Alert>
      ) : null}
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        tone="danger"
        title={t("dialogTitle")}
        consequence={t("dialogBody")}
        confirmLabel={t("dialogConfirm")}
        onConfirm={request}
      />
    </div>
  );
}
