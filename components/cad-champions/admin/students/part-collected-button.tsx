"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { Button, ConfirmDialog, useToast } from "@/components/cad-champions/ui";
import type { Locale } from "@/i18n/routing";
import { formatNumber } from "@/lib/cad-champions/format";
import { recordPhaseMarkerAction } from "@/lib/cad-champions/test/actions";
import { PART_COLLECTED_KEY } from "@/lib/cad-champions/test/timer";

// M4 in-person: the trainer records "Physical part collected" for every
// running attempt of a session that has no marker yet (the existing
// recordPhaseMarkerAction; staff may record it at any time; first time wins,
// audit-logged). The student's timer also records it at 2:00.

export function PartCollectedButton({ locale, attemptIds }: { locale: Locale; attemptIds: string[] }) {
  const t = useTranslations("CC.admin.students");
  const tc = useTranslations("CC.admin.common");
  const toast = useToast();
  const router = useRouter();
  const [open, setOpen] = React.useState(false);

  async function record() {
    let done = 0;
    let failed = 0;
    for (const id of attemptIds) {
      try {
        const res = await recordPhaseMarkerAction(id, PART_COLLECTED_KEY);
        if (res.ok) done += 1;
        else failed += 1;
      } catch (e) {
        console.error("[cc-admin] part collected failed", e);
        failed += 1;
      }
    }
    if (failed === 0) toast.success(t("inPerson.partRecorded", { count: formatNumber(done, locale) }), t("inPerson.partRecordedBody"));
    else toast.error(t("inPerson.partFailed", { count: formatNumber(failed, locale) }), tc("errors.error"));
    setOpen(false);
    router.refresh();
  }

  if (attemptIds.length === 0) return null;
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        {t("inPerson.partButton")}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t("inPerson.partConfirmTitle")}
        consequence={t("inPerson.partConfirmBody", { count: formatNumber(attemptIds.length, locale) })}
        confirmLabel={t("inPerson.partButton")}
        cancelLabel={tc("cancel")}
        onConfirm={record}
      />
    </>
  );
}
