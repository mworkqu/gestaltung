"use client";

// 3D model (CAD) — the gate and the cost dialog only. Generation itself comes
// with the CAD stage: Confirm stores the tier on the project (set_cad_request)
// and spends NOTHING. When generation exists, its API route will call
// canUse("cad") before and spend("cad") after the first delivered result.

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Box, Loader2 } from "lucide-react";

import { Card, PrimaryButton, SoftButton, fieldClass } from "@/components/prototyping/ui";
import { AccessNote, CostLabel } from "@/components/credits/access-note";
import { classifyCadRequest, type CadTier } from "@/lib/credits/classify";
import { CAD_GENERATIONS, CREDIT_QAR, REDEEM_DAYS } from "@/lib/credits/constants";
import { useCanUse } from "@/lib/credits/use-credits";
import { createClient } from "@/lib/supabase/client";

export function CadCard({ projectId, brief }: { projectId: string; brief: string }) {
  const t = useTranslations("Credits");
  const access = useCanUse("cad", projectId);
  const [description, setDescription] = useState(brief);
  const [dialog, setDialog] = useState<{ tier: CadTier; engine: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<CadTier | null>(null);
  const [error, setError] = useState(false);
  const [blocked, setBlocked] = useState<string | null>(null);

  function start() {
    setDone(null);
    setError(false);
    if (access && !access.allowed) {
      setBlocked(access.reason);
      return;
    }
    setBlocked(null);
    setDialog(classifyCadRequest(description));
  }

  async function confirm() {
    if (!dialog) return;
    setBusy(true);
    const { error: e } = await createClient().rpc("set_cad_request", { p_project: projectId, p_tier: dialog.tier });
    setBusy(false);
    if (e) setError(true);
    else setDone(dialog.tier);
    setDialog(null);
  }

  return (
    <Card
      kicker={t("cadKicker")}
      title={t("cadTitle")}
      intro={t("cadIntro", { n: CAD_GENERATIONS })}
      actions={
        <>
          <CostLabel cost={access?.cost} regens={access?.regens} />
          <PrimaryButton onClick={start} disabled={!description.trim()}>
            <Box className="h-3.5 w-3.5" />
            {t("cadButton")}
          </PrimaryButton>
        </>
      }
    >
      <label className="block space-y-1.5">
        <span className="text-xs font-semibold text-heading">{t("cadDescribe")}</span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className={fieldClass}
          placeholder={t("cadPlaceholder")}
        />
      </label>
      <AccessNote reason={blocked} step="cad" />
      {done && <p className="rounded-xl bg-buy-bg px-3 py-2 text-xs font-medium text-buy">{t("cadStub", { tier: t(`tier_${done}`) })}</p>}
      {error && <p className="text-xs text-destructive">{t("cadError")}</p>}

      {dialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cad-dialog-title"
          onClick={() => !busy && setDialog(null)}
        >
          <div className="neu w-full max-w-md space-y-4 p-6" onClick={(e) => e.stopPropagation()}>
            <h2 id="cad-dialog-title" className="text-lg font-bold text-heading">
              {t("cadDialogTitle")}
            </h2>
            <p className="text-sm leading-relaxed text-body">
              {access?.cost === "included"
                ? t("cadDialogIncluded", { tier: t(`tier_${dialog.tier}`), n: access.regens ?? 0 })
                : access?.cost === "none"
                  ? t("cadDialogAdmin", { tier: t(`tier_${dialog.tier}`) })
                  : t("cadDialogBody", { tier: t(`tier_${dialog.tier}`), qar: CREDIT_QAR, days: REDEEM_DAYS })}
            </p>
            <div className="flex items-center justify-end gap-3">
              <SoftButton onClick={() => setDialog(null)} disabled={busy}>
                {t("cancel")}
              </SoftButton>
              <PrimaryButton onClick={confirm} disabled={busy}>
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {t("confirm")}
              </PrimaryButton>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
