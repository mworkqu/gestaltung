"use client";

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { LifeBuoy, Mail, MessageCircle, Search, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import type { Locale } from "@/i18n/routing";
import { CC_EVENTS, track } from "@/lib/cad-champions/analytics";
import { Ltr } from "@/lib/cad-champions/ltr";
import { ccPath } from "@/lib/cad-champions/routes";
import { cn } from "@/lib/utils";

const ring =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface";

export function NeedHelpButton({
  pageName,
  whatsappNumber,
  supportEmail,
}: {
  pageName: string;
  whatsappNumber: string | null;
  supportEmail: string;
}) {
  const t = useTranslations("CC.ui");
  const locale = useLocale() as Locale;
  const [open, setOpen] = React.useState(false);

  const digits = whatsappNumber ? whatsappNumber.replace(/\D/g, "") : "";
  const whatsappHref = digits
    ? `https://wa.me/${digits}?text=${encodeURIComponent(t("whatsappMessage", { page: pageName }))}`
    : null;
  const mailHref = `mailto:${supportEmail}?subject=${encodeURIComponent(t("emailSubject", { page: pageName }))}`;

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) track(CC_EVENTS.needHelpOpened, { page: pageName });
      }}
    >
      <Dialog.Trigger asChild>
        <button
          type="button"
          aria-label={t("needHelp")}
          className={cn(
            "fixed bottom-4 end-4 z-40 inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-2 rounded-full bg-accent px-3.5 py-3 text-sm font-semibold text-accent-foreground shadow-neu transition-colors hover:bg-cobalt-hover sm:px-5",
            ring
          )}
        >
          <LifeBuoy aria-hidden="true" strokeWidth={1.75} className="h-5 w-5 shrink-0" />
          <span className="hidden sm:inline">{t("needHelp")}</span>
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-ink/40 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none" />
        <Dialog.Content
          className={cn(
            "fixed z-[80] flex flex-col gap-5 overflow-y-auto bg-surface p-6 text-start shadow-neu-lg focus-visible:outline-none",
            // Phones: bottom sheet. Desktop: panel at the end edge, sliding in from that side.
            "inset-x-0 bottom-0 max-h-[85dvh] rounded-t-[1.75rem]",
            "sm:inset-x-auto sm:inset-y-0 sm:end-0 sm:max-h-none sm:w-[24rem] sm:rounded-none sm:rounded-s-[1.75rem]",
            "data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom sm:data-[state=open]:slide-in-from-right sm:rtl:data-[state=open]:slide-in-from-left motion-reduce:animate-none"
          )}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-xl font-extrabold text-heading">{t("needHelpTitle")}</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-body">{t("needHelpDescription")}</Dialog.Description>
            </div>
            <Dialog.Close
              aria-label={t("close")}
              className={cn(
                "-m-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-body hover:text-ink",
                ring
              )}
            >
              <X aria-hidden="true" strokeWidth={1.75} className="h-5 w-5" />
            </Dialog.Close>
          </div>

          <form
            method="get"
            action={ccPath(locale, "/help")}
            role="search"
            className="tile space-y-3"
            onSubmit={() => track(CC_EVENTS.needHelpSearch, { page: pageName })}
          >
            <label htmlFor="cc-help-search" className="flex items-center gap-2 text-sm font-bold text-ink">
              <Search aria-hidden="true" strokeWidth={1.75} className="h-4 w-4 text-accent" />
              {t("searchHelpLabel")}
            </label>
            <div className="flex gap-2">
              <input
                id="cc-help-search"
                name="q"
                type="search"
                placeholder={t("searchHelpPlaceholder")}
                className={cn(
                  "neu-inset min-h-[44px] min-w-0 flex-1 px-4 text-base text-ink placeholder:text-mutedtext",
                  ring
                )}
              />
              <button
                type="submit"
                className={cn(
                  "min-h-[44px] shrink-0 rounded-full bg-accent px-4 text-sm font-semibold text-accent-foreground hover:bg-cobalt-hover",
                  ring
                )}
              >
                {t("searchHelpButton")}
              </button>
            </div>
          </form>

          {whatsappHref ? (
            <a
              href={whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => track(CC_EVENTS.needHelpWhatsapp, { page: pageName })}
              className={cn("tile flex min-h-[44px] items-center gap-3 hover:bg-card", ring)}
            >
              <MessageCircle aria-hidden="true" strokeWidth={1.75} className="h-6 w-6 shrink-0 text-accent" />
              <span>
                <span className="block text-sm font-bold text-ink">{t("whatsappUs")}</span>
                <span className="block text-sm text-body">{t("whatsappHint")}</span>
              </span>
            </a>
          ) : null}

          <a
            href={mailHref}
            onClick={() => track(CC_EVENTS.needHelpEmail, { page: pageName })}
            className={cn("tile flex min-h-[44px] items-center gap-3 hover:bg-card", ring)}
          >
            <Mail aria-hidden="true" strokeWidth={1.75} className="h-6 w-6 shrink-0 text-accent" />
            <span className="min-w-0">
              <span className="block text-sm font-bold text-ink">{t("emailUs")}</span>
              <span className="block break-all text-sm text-body">
                <Ltr>{supportEmail}</Ltr>
              </span>
            </span>
          </a>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
