"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { resolveFlagAction } from "@/app/[locale]/cad-champions/admin/students/actions";
import { Button, ConfirmDialog, useToast } from "@/components/cad-champions/ui";

// "Mark resolved" on one integrity flag (admin). Stamps resolved_at /
// resolved_by and writes the audit log; the flag stays in the history.

export function FlagResolveButton({ studentId, flagId }: { studentId: string; flagId: string }) {
  const t = useTranslations("CC.admin.students");
  const tc = useTranslations("CC.admin.common");
  const toast = useToast();
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  async function confirm() {
    setBusy(true);
    try {
      const res = await resolveFlagAction({ studentId, flagId });
      if (res.ok || res.error === "conflict") {
        toast.success(t("flags.resolved"), t("flags.resolvedBody"));
        setOpen(false);
        router.refresh();
      } else toast.error(t("flags.resolveFailed"), tc(`errors.${res.error}`));
    } catch (e) {
      console.error("[cc-admin] resolve failed", e);
      toast.error(t("flags.resolveFailed"), tc("errors.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        {t("flags.resolve")}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t("flags.confirmTitle")}
        consequence={t("flags.confirmBody")}
        confirmLabel={t("flags.resolve")}
        cancelLabel={tc("cancel")}
        loading={busy}
        onConfirm={confirm}
      />
    </>
  );
}
