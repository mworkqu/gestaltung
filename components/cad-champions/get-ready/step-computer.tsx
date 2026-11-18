"use client";

import * as React from "react";
import { ImageIcon, Laptop, MessageCircle } from "lucide-react";
import { useTranslations } from "next-intl";

import { Alert, Button, HelpTip } from "@/components/cad-champions/ui";
import type { CcComputerAccess } from "@/lib/cad-champions/db/types";
import { FIND_SPECS_STEPS, HELP_SLUGS, REQUIREMENT_COLUMNS, REQUIREMENT_ROWS } from "@/lib/cad-champions/get-ready/content";

import { HelpLink, StepsList, SubHeading } from "./shared";

export function StepComputer({
  hasWindowsPc,
  noComputerWhatsappUrl,
}: {
  hasWindowsPc: CcComputerAccess | null;
  noComputerWhatsappUrl: string | null;
}) {
  const t = useTranslations("CC.get-ready");

  return (
    <div className="space-y-5">
      {hasWindowsPc === "no_computer" ? (
        <Alert
          tone="warning"
          title={t("computer.noComputerTitle")}
          action={
            noComputerWhatsappUrl ? (
              <Button asChild variant="secondary" size="sm">
                <a href={noComputerWhatsappUrl} target="_blank" rel="noopener noreferrer">
                  <MessageCircle aria-hidden="true" strokeWidth={1.75} className="h-4 w-4" />
                  {t("computer.noComputerCta")}
                </a>
              </Button>
            ) : null
          }
        >
          <p>{t("computer.noComputerText")}</p>
          {!noComputerWhatsappUrl ? <p className="mt-1">{t("computer.noComputerNoWhatsapp")}</p> : null}
        </Alert>
      ) : null}

      {hasWindowsPc === "mac_only" ? (
        <Alert tone="info" title={t("computer.macOnlyTitle")}>
          {t("computer.macOnlyText")}
        </Alert>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[30rem] border-separate border-spacing-0 text-start text-sm">
          <caption className="pb-2 text-start text-sm font-extrabold text-heading">{t("computer.tableCaption")}</caption>
          <thead>
            <tr>
              <th scope="col" className="border-b border-border px-3 py-2 text-start font-semibold text-body">
                {t("computer.columnItem")}
              </th>
              {REQUIREMENT_COLUMNS.map((c) => (
                <th key={c} scope="col" className="border-b border-border px-3 py-2 text-start font-semibold text-ink">
                  {t(`computer.columns.${c}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {REQUIREMENT_ROWS.map((r) => (
              <tr key={r}>
                <th scope="row" className="border-b border-border px-3 py-2 text-start font-semibold text-ink">
                  {t(`computer.rows.${r}.label`)}
                </th>
                {REQUIREMENT_COLUMNS.map((c) => (
                  <td key={c} className="border-b border-border px-3 py-2 text-body">
                    {t(`computer.rows.${r}.${c}`)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="tile flex items-start gap-3">
        <Laptop aria-hidden="true" strokeWidth={1.75} className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
        <div>
          <p className="text-sm font-bold text-ink">{t("computer.macTitle")}</p>
          <p className="mt-1 text-sm text-body">{t("computer.macText")}</p>
          <HelpLink slug={HELP_SLUGS.onlyMac}>{t("list.helpLink")}</HelpLink>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <SubHeading>{t("computer.findSpecsTitle")}</SubHeading>
          <HelpTip label={t("computer.findSpecsHelp")}>{t("computer.findSpecsHelpText")}</HelpTip>
        </div>
        <StepsList items={FIND_SPECS_STEPS.map((s) => t(`computer.findSpecs.${s}`))} />
        <div
          role="img"
          aria-label={t("computer.illustration")}
          className="neu-inset flex aspect-[16/7] w-full max-w-md flex-col items-center justify-center gap-2 rounded-2xl p-4 text-center"
        >
          <ImageIcon aria-hidden="true" strokeWidth={1.5} className="h-8 w-8 text-mutedtext" />
          <p className="text-xs text-body">{t("computer.illustration")}</p>
        </div>
      </div>
    </div>
  );
}
