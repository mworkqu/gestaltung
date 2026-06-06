"use client";

import { useState, useTransition } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Loader2 } from "lucide-react";

import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { JOB_STATUSES, nextStatus } from "@/lib/jobs/constants";
import { assignWorkshop, changeStatus } from "@/app/[locale]/dashboard/jobs/actions";
import type { Role } from "@/lib/supabase/types";

const controlClass =
  "rounded-xl border border-white/60 bg-panel px-3 py-2 text-sm text-heading shadow-neu-inset focus:outline-none focus:ring-2 focus:ring-cobalt/60";

export function JobActions({
  role,
  jobId,
  status,
  assignedWorkshopTenantId,
  isOwnerClient,
  isAssignedWorkshop,
  workshopTenants,
}: {
  role: Role;
  jobId: string;
  status: string;
  assignedWorkshopTenantId: string | null;
  isOwnerClient: boolean;
  isAssignedWorkshop: boolean;
  workshopTenants: { id: string; name: string }[];
}) {
  const t = useTranslations("Jobs");
  const locale = useLocale();
  const isRtl = locale === "ar";
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [assignSel, setAssignSel] = useState(assignedWorkshopTenantId ?? "");
  const [statusSel, setStatusSel] = useState(status);

  const mono = (extra = "") =>
    cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  function run(fn: () => Promise<{ error?: string; ok?: boolean }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res.error) setError(t(res.error as Parameters<typeof t>[0]));
      else router.refresh();
    });
  }

  const next = nextStatus(status);
  // 'submitted' -> 'quoted' is handled by the BOM / Start Job panel (it also
  // deducts stock), so the plain advance starts from 'quoted' onward.
  const showWorkshopAdvance =
    isAssignedWorkshop && next !== null && status !== "submitted";
  const showClientCancel =
    isOwnerClient && status === "submitted" && !assignedWorkshopTenantId;

  if (
    role !== "super_admin" &&
    !showWorkshopAdvance &&
    !showClientCancel
  ) {
    return null;
  }

  return (
    <div className="neu mt-6 space-y-5 p-5">
      <p className={mono("text-[10px] text-azure")}>{t("actionsTitle")}</p>

      {/* super_admin: assign workshop + override status */}
      {role === "super_admin" && (
        <div className="space-y-4">
          <div className="space-y-2">
            <label className={mono("block text-[10px] text-mutedtext")}>
              {t("assignWorkshopLabel")}
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={assignSel}
                onChange={(e) => setAssignSel(e.target.value)}
                className={cn(controlClass, isRtl && "text-right")}
              >
                <option value="">{t("unassigned")}</option>
                {workshopTenants.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                size="sm"
                disabled={pending}
                onClick={() =>
                  run(() =>
                    assignWorkshop({
                      locale,
                      jobId,
                      workshopTenantId: assignSel || null,
                    })
                  )
                }
                className="rounded-full"
              >
                {t("assignButton")}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <label className={mono("block text-[10px] text-mutedtext")}>
              {t("overrideStatusLabel")}
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={statusSel}
                onChange={(e) => setStatusSel(e.target.value)}
                className={cn(controlClass, isRtl && "text-right")}
              >
                {JOB_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`status_${s}`)}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() =>
                  run(() => changeStatus({ locale, jobId, status: statusSel }))
                }
                className="rounded-full"
              >
                {t("applyButton")}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* workshop: advance one step */}
      {showWorkshopAdvance && next && (
        <Button
          type="button"
          disabled={pending}
          onClick={() => run(() => changeStatus({ locale, jobId, status: next }))}
          className="rounded-full"
        >
          {pending && <Loader2 className="animate-spin" />}
          {t("advanceTo", { status: t(`status_${next}`) })}
        </Button>
      )}

      {/* client: cancel before assignment */}
      {showClientCancel && (
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() =>
            run(() => changeStatus({ locale, jobId, status: "cancelled" }))
          }
          className="rounded-full"
        >
          {pending && <Loader2 className="animate-spin" />}
          {t("cancelJob")}
        </Button>
      )}

      {error && <p className="text-sm font-medium text-destructive">{error}</p>}
    </div>
  );
}
