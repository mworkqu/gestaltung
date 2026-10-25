"use client";

// Deleting a project (split out of project-workspace.tsx, R8).

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Project } from "@/lib/supabase/types";

// ── Danger zone ─────────────────────────────────────────────────────────────
// Deleting sits at the bottom, away from the title (audit #18).

export function DangerZoneCard({
  project,
  reclaimable,
  onDeleted,
}: {
  project: Project;
  /** Units on this project that came off the client's own shelf. */
  reclaimable: number;
  onDeleted: () => void;
}) {
  const t = useTranslations("Projects");
  const [deleting, setDeleting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(false);

  // Cancelling a project frees whatever it was holding. Anything that came off
  // their own shelf can go back there — but that is their call, so we ask
  // rather than assume. The cart lines are released either way, because the
  // project that justified them no longer exists.
  //
  // One RPC = one transaction (0035): the ownership check, the put-back, the
  // cart clean-up and the delete all happen or none do, so "nothing was
  // changed" on failure is true.
  async function remove(putBack: boolean) {
    setDeleting(true);
    setError(false);
    const { error: rpcErr } = await createClient().rpc("delete_project", {
      p_id: project.id,
      p_put_back: putBack,
    });
    if (rpcErr) {
      setError(true);
      setDeleting(false);
      return;
    }
    onDeleted();
  }

  return (
    <section className="space-y-3 pt-2">
      {!confirming && (
        <div className="text-center">
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={deleting}
            className="inline-flex min-h-11 items-center px-3 text-xs text-mutedtext underline-offset-2 transition-colors hover:text-destructive hover:underline disabled:opacity-60"
          >
            {t("deleteProject")}
          </button>
        </div>
      )}

      {confirming && (
        <div className="space-y-3 rounded-xl bg-panel p-4 shadow-neu-inset">
          <p className="text-sm text-heading">
            {reclaimable > 0
              ? t("cancelWithParts", { count: reclaimable })
              : t("deleteConfirm")}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {reclaimable > 0 && (
              <button
                type="button"
                onClick={() => remove(true)}
                disabled={deleting}
                className="rounded-lg bg-cobalt px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-cobalt-hover disabled:opacity-60 max-md:min-h-11"
              >
                {t("returnParts")}
              </button>
            )}
            <button
              type="button"
              onClick={() => remove(false)}
              disabled={deleting}
              className="rounded-lg bg-surface px-3.5 py-2 text-xs font-semibold text-destructive shadow-neu-sm transition-colors disabled:opacity-60 max-md:min-h-11"
            >
              {reclaimable > 0 ? t("discardParts") : t("deleteProject")}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={deleting}
              className="rounded-lg px-3.5 py-2 text-xs font-semibold text-mutedtext transition-colors hover:text-heading max-md:min-h-11"
            >
              {t("keepProject")}
            </button>
            {deleting && <Loader2 className="h-4 w-4 animate-spin text-mutedtext" />}
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {t("deleteFailed")}
        </p>
      )}
    </section>
  );
}
