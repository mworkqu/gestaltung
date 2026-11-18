"use client";

import * as React from "react";
import { useTranslations } from "next-intl";

import { renderTemplateAction, sendTemplateTestAction } from "@/app/[locale]/cad-champions/admin/emails/actions";
import { Button, StatusChip, useToast } from "@/components/cad-champions/ui";
import type { EmailGroup, RenderedEmail } from "@/lib/cad-champions/admin/email-templates";
import { cn } from "@/lib/utils";

import { EmailFrame, EmailText } from "./email-frame";

export type TemplateItem = { id: string; group: EmailGroup; localeAware: boolean; ownerOnly: boolean; bilingual: boolean };

type Lang = "en" | "ar";
type Tab = "html" | "text";

export function EmailPreviewList({ items, adminEmail }: { items: TemplateItem[]; adminEmail: string | null }) {
  const t = useTranslations("CC.admin.emails");
  const tc = useTranslations("CC.admin.common");
  const toast = useToast();
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [lang, setLang] = React.useState<Lang>("en");
  const [tab, setTab] = React.useState<Tab>("html");
  const [loading, setLoading] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const [mail, setMail] = React.useState<RenderedEmail | null>(null);
  const [sending, setSending] = React.useState<string | null>(null);
  const reqRef = React.useRef(0);

  const groups = [...new Set(items.map((i) => i.group))];

  async function load(id: string, l: Lang) {
    const n = ++reqRef.current;
    setLoading(true);
    setFailed(false);
    const r = await renderTemplateAction({ id, locale: l });
    if (n !== reqRef.current) return;
    setLoading(false);
    if (r.ok) setMail(r.data);
    else {
      setMail(null);
      setFailed(true);
    }
  }

  function toggle(item: TemplateItem) {
    if (openId === item.id) {
      setOpenId(null);
      return;
    }
    setOpenId(item.id);
    setMail(null);
    void load(item.id, lang);
  }

  function pickLang(item: TemplateItem, l: Lang) {
    setLang(l);
    void load(item.id, l);
  }

  async function sendTest(item: TemplateItem) {
    setSending(item.id);
    try {
      const r = await sendTemplateTestAction({ id: item.id, locale: lang });
      if (r.ok) toast.success(t("actions.testSent", { email: r.data.email }));
      else if (r.error === "rate_limited") toast.error(t("actions.rateLimited"));
      else toast.error(t("actions.testFailed"), r.error === "not_found" ? t("errors.noEmail") : undefined);
    } finally {
      setSending(null);
    }
  }

  return (
    <div className="space-y-8">
      {groups.map((g) => (
        <section key={g} aria-labelledby={`grp-${g}`} className="space-y-3">
          <h2 id={`grp-${g}`} className="title-section">
            {t(`groups.${g}`)}
          </h2>
          <ul className="space-y-3">
            {items
              .filter((i) => i.group === g)
              .map((item) => {
                const open = openId === item.id;
                return (
                  <li key={item.id} className="neu space-y-4 p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <h3 className="title-card">{t(`templates.${item.id}.title`)}</h3>
                        <p className="text-sm text-body">{t(`templates.${item.id}.when`)}</p>
                        <div className="flex flex-wrap gap-2 pt-1">
                          <StatusChip tone={item.bilingual ? "info" : "neutral"}>{item.bilingual ? t("chips.bilingual") : t("chips.singleLanguage")}</StatusChip>
                          {item.ownerOnly ? <StatusChip tone="warning">{t("chips.ownerOnly")}</StatusChip> : null}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button variant="secondary" size="sm" onClick={() => toggle(item)} aria-expanded={open}>
                          {open ? tc("hidePreview") : tc("showPreview")}
                        </Button>
                        <Button size="sm" onClick={() => sendTest(item)} loading={sending === item.id} loadingText={t("actions.sending")} disabled={!adminEmail} disabledReason={t("errors.noEmail")}>
                          {t("actions.sendTest")}
                        </Button>
                      </div>
                    </div>

                    {open ? (
                      <div className="space-y-3 border-t border-border pt-4">
                        <div className="flex flex-wrap items-center gap-2">
                          {item.localeAware
                            ? (["en", "ar"] as const).map((l) => (
                                <button
                                  key={l}
                                  type="button"
                                  aria-pressed={lang === l}
                                  onClick={() => pickLang(item, l)}
                                  className={cn("min-h-11 rounded-full px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent", lang === l ? "bg-accent text-accent-foreground" : "bg-surface text-ink shadow-neu-sm")}
                                >
                                  {t(`view.first.${l}`)}
                                </button>
                              ))
                            : null}
                          <div role="tablist" aria-label={t("view.tabs")} className="ms-auto flex gap-2">
                            {(["html", "text"] as const).map((k) => (
                              <button
                                key={k}
                                type="button"
                                role="tab"
                                aria-selected={tab === k}
                                onClick={() => setTab(k)}
                                className={cn("min-h-11 rounded-full px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent", tab === k ? "bg-accent text-accent-foreground" : "bg-surface text-ink shadow-neu-sm")}
                              >
                                {t(`view.${k}`)}
                              </button>
                            ))}
                          </div>
                        </div>
                        {loading ? (
                          <p role="status" className="text-sm text-mutedtext">
                            {t("actions.loading")}
                          </p>
                        ) : failed ? (
                          <p role="alert" className="text-sm font-semibold text-[#a1231f]">
                            {t("errors.render")}
                          </p>
                        ) : mail ? (
                          <>
                            <p className="text-sm text-body">
                              <span className="font-semibold text-ink">{t("view.subject")}: </span>
                              <span dir="auto">{mail.subject}</span>
                            </p>
                            {tab === "html" ? <EmailFrame html={mail.html} title={t("view.frameTitle")} /> : <EmailText text={mail.text} />}
                            <p className="text-xs text-mutedtext">{t("view.sampleNote")}</p>
                          </>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
          </ul>
        </section>
      ))}
    </div>
  );
}
