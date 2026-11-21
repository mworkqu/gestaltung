"use client";

// Website booking UI for a paid meeting with the engineer. Used on /contact and
// in the Studio's Make step. Guests may book — no sign-in.
//
// It shows the owner's rules as the server computed them (price, invoicing and
// the change window come from /api/meetings/slots, never hard-coded here), so
// editing store_settings.meetings changes the page without a deploy.

import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { requestTurnstileToken } from "@/lib/turnstile-client";

type SlotOption = { starts_at: string; label_en: string; label_ar: string };
type ModeOption = { mode: "online" | "studio"; label: string; detail: string };
type SlotsResponse = { slots: SlotOption[]; price_qar: number; lines: string[]; modes: ModeOption[]; company: string };

const card = "neu w-full space-y-4 p-5 sm:p-6";
const button =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-cobalt px-6 text-sm font-semibold text-white transition-colors hover:bg-cobalt-hover active:scale-[0.98] disabled:opacity-60";
const field =
  "w-full min-h-11 rounded-xl border border-white/60 bg-panel px-3 py-2 text-base text-heading shadow-neu-inset outline-none placeholder:text-faint focus:ring-2 focus:ring-cobalt/60";
const label = "block space-y-1";
const labelText = "text-xs font-semibold text-mutedtext";

/** API error code -> message key. */
const ERRORS: Record<string, string> = {
  slot_taken: "errorSlotTaken",
  too_soon: "errorTooSoon",
  bad_slot: "errorBadSlot",
  too_many: "errorTooMany",
  bad_phone: "errorPhone",
  bad_email: "errorEmail",
  not_set_up: "notReady",
};

export function MeetingBooking({ compact = false }: { compact?: boolean }) {
  const t = useTranslations("Meetings");
  const locale = useLocale();
  const ar = locale === "ar";

  const [data, setData] = useState<SlotsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [slot, setSlot] = useState("");
  const [mode, setMode] = useState<"online" | "studio">("online");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [topic, setTopic] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ manage: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/meetings/slots?locale=${locale}`, { headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as SlotsResponse;
      setData(json);
      setSlot((s) => s || json.slots[0]?.starts_at || "");
      setMode((m) => (json.modes.some((x) => x.mode === m) ? m : (json.modes[0]?.mode ?? "online")));
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [locale]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !phone.trim() || !slot) {
      setError(t("required"));
      return;
    }
    setBusy(true);
    try {
      const token = await requestTurnstileToken().catch(() => null);
      const res = await fetch("/api/meetings/book", {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { "x-turnstile-token": token } : {}) },
        body: JSON.stringify({
          starts_at: slot,
          mode,
          name: name.trim(),
          phone: phone.trim(),
          email: email.trim() || undefined,
          topic: topic.trim() || undefined,
          locale,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; manage_link?: string; error?: string };
      if (!res.ok || !json.ok) {
        const key = json.error ? ERRORS[json.error] : undefined;
        setError(key ? t(key) : t("error"));
        // someone may have taken the slot: refresh the list
        if (json.error === "slot_taken") void load();
        return;
      }
      setDone({ manage: json.manage_link ?? "" });
    } catch {
      setError(t("error"));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className={card} data-testid="meeting-booked">
        <h2 className="text-lg font-black tracking-tight text-heading">{t("successTitle")}</h2>
        <p className="text-sm text-body">{t("successBody")}</p>
        {done.manage && (
          <a href={done.manage} className="inline-flex min-h-11 items-center text-sm font-semibold text-cobalt underline-offset-2 hover:underline">
            {t("manageLink")}
          </a>
        )}
        {data && <p className="text-xs text-faint">{data.company}</p>}
      </div>
    );
  }

  const labelFor = (s: SlotOption) => (ar ? s.label_ar : s.label_en);

  return (
    <form className={card} onSubmit={submit} data-testid="meeting-booking">
      {!compact && <h2 className="text-lg font-black tracking-tight text-heading">{t("bookTitle")}</h2>}

      {data && (
        <ul className="space-y-1 text-sm text-body" data-testid="meeting-rules">
          {data.lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}

      {loading ? (
        <p className="text-sm text-mutedtext" role="status">
          {t("submitting")}
        </p>
      ) : !data?.slots.length ? (
        <p className="text-sm text-body" data-testid="meeting-no-times">
          {t("noTimes")}
        </p>
      ) : (
        <>
          <label className={label}>
            <span className={labelText}>{t("pickTime")}</span>
            <select value={slot} onChange={(e) => setSlot(e.target.value)} className={field} data-testid="meeting-slot">
              {data.slots.map((s) => (
                <option key={s.starts_at} value={s.starts_at}>
                  {labelFor(s)}
                </option>
              ))}
            </select>
          </label>

          <fieldset className="space-y-2">
            <legend className={labelText}>{t("modeLabel")}</legend>
            {data.modes.map((m) => (
              <label key={m.mode} className="flex items-start gap-2 text-sm text-body">
                <input
                  type="radio"
                  name="meeting-mode"
                  value={m.mode}
                  checked={mode === m.mode}
                  onChange={() => setMode(m.mode)}
                  className="mt-1 h-4 w-4 accent-cobalt"
                />
                <span>
                  <span className="font-semibold text-heading">{m.label}</span>
                  <span className="block text-xs text-mutedtext">{m.detail}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <label className={label}>
            <span className={labelText}>{t("nameLabel")}</span>
            <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className={field} maxLength={60} />
          </label>

          <label className={label}>
            <span className={labelText}>{t("phoneLabel")}</span>
            <input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              dir="ltr"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+974 5555 1234"
              className={`${field} text-start`}
              maxLength={20}
            />
          </label>

          <label className={label}>
            <span className={labelText}>{t("emailLabel")}</span>
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              dir="ltr"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={`${field} text-start`}
              maxLength={160}
            />
          </label>

          <label className={label}>
            <span className={labelText}>{t("topicLabel")}</span>
            <textarea value={topic} onChange={(e) => setTopic(e.target.value)} rows={3} maxLength={400} className={field} />
            <span className="text-xs text-faint">{t("topicHint")}</span>
          </label>

          {error && (
            <p className="text-sm font-medium text-destructive" role="alert" data-testid="meeting-error">
              {error}
            </p>
          )}

          <button type="submit" disabled={busy} className={button}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {busy ? t("submitting") : t("submit")}
          </button>

          {data && <p className="text-xs text-faint">{data.company}</p>}
        </>
      )}
    </form>
  );
}
