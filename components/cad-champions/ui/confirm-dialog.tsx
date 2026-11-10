"use client";

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

import { Button } from "./button";

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  consequence,
  confirmLabel,
  cancelLabel,
  tone = "default",
  loading = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  consequence: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
  loading?: boolean;
  onConfirm: () => void | Promise<void>;
}) {
  const t = useTranslations("CC.ui");
  const [busy, setBusy] = React.useState(false);
  const cancelRef = React.useRef<HTMLButtonElement>(null);
  const working = loading || busy;

  async function handleConfirm() {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => (working ? undefined : onOpenChange(next))}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-ink/40 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none" />
        <Dialog.Content
          onOpenAutoFocus={(e) => {
            // Initial focus on Cancel: the safe choice, especially for destructive actions.
            e.preventDefault();
            cancelRef.current?.focus();
          }}
          className={cn(
            "neu fixed start-1/2 top-1/2 z-[80] w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 p-6 text-start rtl:translate-x-1/2 sm:p-8",
            "focus-visible:outline-none"
          )}
        >
          <Dialog.Title className="text-xl font-extrabold text-heading">{title}</Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-body">{consequence}</Dialog.Description>
          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Dialog.Close asChild>
              <Button ref={cancelRef} variant="secondary" disabled={working}>
                {cancelLabel ?? t("cancel")}
              </Button>
            </Dialog.Close>
            <Button
              variant={tone === "danger" ? "danger" : "primary"}
              loading={working}
              loadingText={t("working")}
              onClick={handleConfirm}
            >
              {confirmLabel}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
