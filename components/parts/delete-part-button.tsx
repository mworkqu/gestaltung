"use client";

import { useState, useTransition } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Loader2, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { deletePart } from "@/app/[locale]/dashboard/store/actions";

export function DeletePartButton({ id, name }: { id: string; name: string }) {
  const t = useTranslations("PartsDashboard");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function close() {
    setOpen(false);
    setError(null);
  }

  // On failure the modal stays open with the reason (e.g. the product is used
  // by an order), instead of closing as if it had worked.
  function confirmDelete() {
    const formData = new FormData();
    formData.set("id", id);
    formData.set("locale", locale);
    setError(null);
    startTransition(async () => {
      try {
        const result = await deletePart(formData);
        if (result?.error) {
          setError(result.error);
          return;
        }
        close();
      } catch {
        setError(t("error_unknown"));
      }
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={t("delete")}
        onClick={() => setOpen(true)}
        className="h-8 w-8 text-mutedtext hover:text-destructive"
      >
        <Trash2 className="h-4 w-4" />
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => !pending && close()}
        >
          <div className="neu w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-heading">{t("deleteTitle")}</h2>
            <p className="mt-2 text-sm leading-relaxed text-body">
              {t("deleteConfirm", { name })}
            </p>
            {error && (
              <p role="alert" className="mt-3 text-sm font-medium text-destructive">
                {error}
              </p>
            )}
            <div className="mt-6 flex items-center justify-end gap-3">
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={close}
                className="rounded-full"
              >
                {t("cancel")}
              </Button>
              <Button
                type="button"
                disabled={pending}
                onClick={confirmDelete}
                className="rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {pending && <Loader2 className="animate-spin" />}
                {t("delete")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
