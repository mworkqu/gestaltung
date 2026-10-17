"use client";

// The contact-number form (Dashboard → Settings → Contact info). Shows the
// number in use with its WhatsApp and tel: links, lets the owner type a new
// one; saveContactPhone normalises it to E.164 and refreshes the cached pages.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, MessageCircle, Phone, Save } from "lucide-react";

import { saveContactPhone } from "@/app/[locale]/dashboard/contact/actions";
import { contactPhoneFrom, parseContactPhoneInput, type ContactPhone } from "@/lib/contact-phone";

const input =
  "w-full max-w-xs rounded-lg border border-white/60 bg-surface px-3 py-2 text-sm text-heading shadow-neu-inset outline-none focus:ring-2 focus:ring-cobalt/60";

export function ContactInfoEditor({ locale, phone }: { locale: string; phone: ContactPhone }) {
  const t = useTranslations("ContactInfo");
  const router = useRouter();
  const [value, setValue] = useState(phone.display);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const parsed = parseContactPhoneInput(value);
  const preview = parsed ? contactPhoneFrom(parsed) : null;
  const changed = parsed !== phone.e164;

  const save = () => {
    if (!parsed) {
      setMsg({ kind: "error", text: t("invalid") });
      return;
    }
    start(async () => {
      const res = await saveContactPhone(locale, parsed);
      if ("error" in res) {
        setMsg({ kind: "error", text: res.error === "invalid" ? t("invalid") : t("failed") });
        return;
      }
      setMsg({ kind: "ok", text: t("saved") });
      router.refresh();
    });
  };

  return (
    <div className="neu space-y-4 p-6">
      <div>
        <h2 className="text-lg font-bold text-heading">{t("phoneTitle")}</h2>
        <p className="mt-1 text-xs text-mutedtext">{t("phoneHelp")}</p>
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <a
          href={phone.whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          dir="ltr"
          className="inline-flex items-center gap-1.5 font-semibold text-cobalt hover:underline"
        >
          <MessageCircle className="h-4 w-4" aria-hidden />
          {phone.display}
        </a>
        <a href={phone.tel} dir="ltr" className="inline-flex items-center gap-1.5 text-body hover:underline">
          <Phone className="h-4 w-4" aria-hidden />
          {phone.e164}
        </a>
      </div>
      <label className="block space-y-1">
        <span className="text-xs font-semibold text-mutedtext">{t("phoneLabel")}</span>
        <input
          type="tel"
          dir="ltr"
          inputMode="tel"
          className={input}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setMsg(null);
          }}
          placeholder="+974 XXXX XXXX"
          data-testid="contact-phone-input"
        />
      </label>
      {preview && changed && (
        <p className="text-xs text-mutedtext" dir="ltr">
          {t("willBeStored")} {preview.e164} · {preview.whatsappUrl}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={pending || !changed}
          className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-cobalt px-4 text-sm font-semibold text-white hover:bg-cobalt-hover disabled:opacity-50"
          data-testid="contact-phone-save"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
          {t("save")}
        </button>
        {msg && (
          <p role="status" className={msg.kind === "ok" ? "text-sm text-emerald-700" : "text-sm text-red-700"}>
            {msg.text}
          </p>
        )}
      </div>
    </div>
  );
}
