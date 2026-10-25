"use client";

// The tier checkpoint (2026-10-25): a turn that would move the build into a higher
// tier, or start a different product, comes back from the server as `needsApproval`
// with NOTHING charged and the new card withheld. This asks before a token is spent.
// Approve resends the same turn with `approveTier` (answered from the server's cache,
// charged at exactly the quoted amount); "keep refining" spends nothing and the
// previous card stays. Declining needs no request at all.
//
// A native <dialog> opened with showModal(), like GetItMade: real focus trap, inert
// page behind, Escape handled through our state. Escape means "keep refining".

import { useEffect, useId, useRef } from "react";
import { useTranslations } from "next-intl";
import { Coins } from "lucide-react";

import { Link } from "@/i18n/navigation";
import type { ApprovalAsk } from "@/lib/studio/client/api";

export function TierCheckpoint({
  ask,
  onApprove,
  onKeep,
}: {
  /** Null = closed. */
  ask: ApprovalAsk | null;
  onApprove: () => void;
  onKeep: () => void;
}) {
  const t = useTranslations("Studio");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const approveRef = useRef<HTMLButtonElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const open = ask !== null;

  // Admins have no balance cap; an unknown balance (null) is not "too little", the server decides.
  const short = ask !== null && ask.balance !== null && ask.balance < ask.tokens;

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      // Focus the button by hand. React's `autoFocus` prop does not render an
      // `autofocus` ATTRIBUTE, so showModal() has nothing to honour and parks focus
      // on the dialog element itself - a keyboard user has to tab in from nowhere.
      // Focus what they most likely want: approving when they can afford it,
      // carrying on refining when they cannot. The `!d.open` guard means a later
      // change to `short` never steals focus from someone already reading this.
      (short ? keepRef.current : approveRef.current)?.focus();
    }
    if (!open && d.open) d.close();
  }, [open, short]);
  const n = String(ask?.tokens ?? 0);
  const title = !ask
    ? ""
    : ask.kind === "escalation"
      ? t("tierAsk_escalation", { tier: t(`tiers.${ask.tier}`), n })
      : t("tierAsk_newProduct", { n });

  const primary =
    "inline-flex min-h-12 w-full items-center justify-center rounded-full px-6 text-sm font-semibold sm:w-auto sm:min-w-44";

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      data-testid="studio-tier-ask"
      onCancel={(e) => {
        e.preventDefault();
        onKeep();
      }}
      onClose={() => {
        // Closed by the browser (not through `open`): treat it as keep-refining.
        if (open) onKeep();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onKeep();
      }}
      className="m-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-y-auto rounded-t-[28px] bg-surface p-0 text-heading shadow-neu backdrop:bg-black/40 sm:m-auto sm:max-w-lg sm:rounded-[28px]"
    >
      {ask && (
        <div className="space-y-4 p-5 sm:p-6" data-kind={ask.kind} data-tokens={ask.tokens} data-short={short ? "1" : "0"}>
          <h2 id={titleId} className="text-lg font-extrabold leading-snug tracking-tight">
            {title}
          </h2>

          <p className="flex items-center gap-2 text-sm font-bold" data-testid="studio-tier-ask-balance">
            <Coins className="h-4 w-4 shrink-0 text-mutedtext" strokeWidth={2} aria-hidden />
            {ask.balance === null ? "…" : t("tokens.balance", { n: String(ask.balance) })}
          </p>

          {ask.reasons.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-sm font-semibold text-mutedtext">{t("tierAsk_why")}</p>
              <ul className="list-disc space-y-1 ps-5 text-sm leading-relaxed" data-testid="studio-tier-ask-reasons">
                {ask.reasons.map((r) => (
                  <li key={r}>{t(`tierWhy_${r}`)}</li>
                ))}
              </ul>
            </div>
          )}

          {short && (
            <p role="alert" className="text-sm font-medium text-destructive" data-testid="studio-tier-ask-short">
              {t("tierAsk_short", { n, balance: String(ask.balance ?? 0) })}{" "}
              <Link href="/tokens" className="inline-flex min-h-11 items-center font-semibold underline underline-offset-2">
                {t("tokens.contact")}
              </Link>
            </p>
          )}

          <p className="text-sm leading-relaxed text-mutedtext">{t("tierAsk_free")}</p>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onKeep}
              ref={keepRef}
              data-testid="studio-tier-keep"
              className={`${primary} text-cobalt shadow-neu-sm hover:text-cobalt-hover`}
            >
              {t("tierAsk_keep")}
            </button>
            {!short && (
              <button
                type="button"
                onClick={onApprove}
                ref={approveRef}
                data-testid="studio-tier-approve"
                className={`${primary} bg-cobalt text-white hover:bg-cobalt-hover`}
              >
                {t("tierAsk_approve", { n })}
              </button>
            )}
          </div>
        </div>
      )}
    </dialog>
  );
}
