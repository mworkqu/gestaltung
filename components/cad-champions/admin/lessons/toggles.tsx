"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { setFreePreviewAction, setPublishedAction } from "@/app/[locale]/cad-champions/admin/lessons/actions";
import { useToast } from "@/components/cad-champions/ui";
import { cn } from "@/lib/utils";

// Quick on/off buttons used in the course tree and the lesson list: publish
// state of a module / level / lesson, and the free-preview flag of a lesson.
// Both are audited on the server.

function Pill({ on, busy, onClick, onLabel, offLabel, actionLabel, tone }: { on: boolean; busy: boolean; onClick: () => void; onLabel: string; offLabel: string; actionLabel: string; tone: "publish" | "free" }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={actionLabel}
      title={actionLabel}
      disabled={busy}
      onClick={onClick}
      className={cn(
        "inline-flex min-h-11 items-center rounded-full border px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60",
        on
          ? tone === "publish"
            ? "border-buy/20 bg-buy-bg text-buy"
            : "border-[#c3d6f3] bg-[#e3edfb] text-[#0a3f8f]"
          : "border-border bg-panel text-body hover:bg-surface",
      )}
    >
      {busy ? "…" : on ? onLabel : offLabel}
    </button>
  );
}

export function PublishToggle({ entity, id, published, name }: { entity: "module" | "level" | "lesson"; id: string; published: boolean; name: string }) {
  const t = useTranslations("CC.admin.lessons");
  const tc = useTranslations("CC.admin.common");
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = React.useState(false);
  async function toggle() {
    setBusy(true);
    try {
      const res = await setPublishedAction({ entity, id, published: !published });
      if (res.ok) {
        toast.success(!published ? t("toggles.nowPublished") : t("toggles.nowDraft"), t("toggles.studentsNote"));
        router.refresh();
      } else toast.error(tc(`errors.${res.error}`));
    } catch (e) {
      console.error("[cc-admin-lessons] publish toggle failed", e);
      toast.error(tc("errors.error"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Pill on={published} busy={busy} onClick={toggle} onLabel={tc("published")} offLabel={tc("draft")} actionLabel={t(published ? "toggles.unpublishNamed" : "toggles.publishNamed", { name })} tone="publish" />
  );
}

export function FreePreviewToggle({ id, value, name }: { id: string; value: boolean; name: string }) {
  const t = useTranslations("CC.admin.lessons");
  const tc = useTranslations("CC.admin.common");
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = React.useState(false);
  async function toggle() {
    setBusy(true);
    try {
      const res = await setFreePreviewAction({ id, value: !value });
      if (res.ok) {
        toast.success(!value ? t("toggles.freeOn") : t("toggles.freeOff"), t("toggles.freeNote"));
        router.refresh();
      } else toast.error(tc(`errors.${res.error}`));
    } catch (e) {
      console.error("[cc-admin-lessons] free preview toggle failed", e);
      toast.error(tc("errors.error"));
    } finally {
      setBusy(false);
    }
  }
  return <Pill on={value} busy={busy} onClick={toggle} onLabel={t("toggles.freePreview")} offLabel={t("toggles.notFree")} actionLabel={t(value ? "toggles.freeOffNamed" : "toggles.freeOnNamed", { name })} tone="free" />;
}
