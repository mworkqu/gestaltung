"use client";

// Projects used to be deleted from the project page; product projects now open straight in the
// Studio, so the same action lives here: a small quiet link under the steps, one confirm, the
// same delete_project() RPC (0035: ownership check, cart clean-up and delete in one transaction).

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { useRouter } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";

export function DeleteProject({ projectId }: { projectId: string }) {
  const t = useTranslations("Studio");
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function remove() {
    setBusy(true);
    setError(false);
    const { error: rpcErr } = await createClient().rpc("delete_project", { p_id: projectId, p_put_back: false });
    if (rpcErr) {
      setError(true);
      setBusy(false);
      return;
    }
    router.push("/projects");
  }

  return (
    <section className="pt-2" data-testid="studio-delete-project">
      {!confirming ? (
        <div className="text-center">
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="inline-flex min-h-11 items-center px-3 text-xs text-mutedtext underline-offset-2 transition-colors hover:text-destructive hover:underline"
          >
            {t("deleteProject")}
          </button>
        </div>
      ) : (
        <div className="space-y-3 rounded-xl bg-panel p-4 shadow-neu-inset">
          <p className="text-sm text-heading">{t("deleteProjectConfirm")}</p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void remove()}
              disabled={busy}
              className="min-h-11 rounded-lg bg-surface px-3.5 py-2 text-xs font-semibold text-destructive shadow-neu-sm transition-colors disabled:opacity-60"
            >
              {t("deleteProjectYes")}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={busy}
              className="min-h-11 rounded-lg px-3.5 py-2 text-xs font-semibold text-mutedtext transition-colors hover:text-heading"
            >
              {t("deleteProjectKeep")}
            </button>
            {busy && <Loader2 className="h-4 w-4 animate-spin text-mutedtext" aria-hidden />}
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm font-medium text-destructive">
          {t("deleteProjectFailed")}
        </p>
      )}
    </section>
  );
}
