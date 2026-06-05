"use client";

import { useState, useTransition } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Loader2, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { deleteItem } from "@/app/[locale]/dashboard/inventory/actions";

// Small icon button that opens a themed confirm modal, then calls the delete
// server action (RLS enforced server-side).
export function DeleteItemButton({
  id,
  name,
}: {
  id: string;
  name: string;
}) {
  const t = useTranslations("Inventory");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function confirmDelete() {
    const formData = new FormData();
    formData.set("id", id);
    formData.set("locale", locale);
    startTransition(async () => {
      await deleteItem(formData);
      setOpen(false);
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
          onClick={() => !pending && setOpen(false)}
        >
          <div
            className="neu w-full max-w-sm p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold text-heading">
              {t("deleteTitle")}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-body">
              {t("deleteConfirm", { name })}
            </p>
            <div className="mt-6 flex items-center justify-end gap-3">
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={() => setOpen(false)}
                className="rounded-full"
              >
                {t("cancel")}
              </Button>
              <Button
                type="button"
                variant="default"
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
