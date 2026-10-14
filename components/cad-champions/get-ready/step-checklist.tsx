"use client";

import * as React from "react";
import { useTranslations } from "next-intl";

import { TEST_DAY_ITEMS } from "@/lib/cad-champions/get-ready/content";
import type { TestDayCheckKey } from "@/lib/cad-champions/get-ready/steps";

import { CheckRow } from "./shared";

export function StepChecklist({
  ticked,
  disabled,
  onTick,
}: {
  ticked: Set<string>;
  disabled: boolean;
  onTick: (sub: TestDayCheckKey, checked: boolean) => void;
}) {
  const t = useTranslations("CC.get-ready");
  const baseId = React.useId();
  return (
    <div className="space-y-3">
      <p className="text-sm text-body">{t("checklist.intro")}</p>
      <p className="text-sm font-semibold text-ink" aria-live="polite">
        {t("checklist.progress", { done: String(ticked.size), total: String(TEST_DAY_ITEMS.length) })}
      </p>
      <ul className="space-y-1">
        {TEST_DAY_ITEMS.map((item) => (
          <li key={item}>
            <CheckRow id={`${baseId}-${item}`} checked={ticked.has(item)} disabled={disabled} onChange={(c) => onTick(item, c)}>
              {t(`checklist.items.${item}`)}
            </CheckRow>
          </li>
        ))}
      </ul>
    </div>
  );
}
