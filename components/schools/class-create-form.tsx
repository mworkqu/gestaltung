"use client";

// "Create a class" (3a). The write is the createClass server action, which
// calls create_school_class() — the RPC mints the unique join code and enforces
// the 20-open-classes limit, so nothing here can get that wrong. Every failure
// comes back as a SchoolClasses message key.

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { createClass, type ClassActionResult } from "@/app/[locale]/schools/classes/actions";

const input =
  "w-full min-h-11 rounded-lg border border-white/60 bg-surface px-3 py-2 text-sm text-heading shadow-neu-inset outline-none focus:ring-2 focus:ring-cobalt/60";

type State = ClassActionResult<{ classId: string; joinCode: string }> | null;

export function ClassCreateForm({ locale }: { locale: string }) {
  const t = useTranslations("SchoolClasses");
  const [state, formAction, pending] = useActionState<State, FormData>(
    async (_prev, formData) => createClass(locale, formData),
    null,
  );

  return (
    <form action={formAction} className="space-y-5">
      {/* grid-cols-1 is repeat(1, minmax(0,1fr)): the one-column phone layout never overflows. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="block space-y-1.5">
          <span className="text-xs font-semibold text-mutedtext">{t("nameLabel")}</span>
          <input
            name="name"
            type="text"
            required
            maxLength={80}
            placeholder={t("namePlaceholder")}
            className={input}
            disabled={pending}
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-semibold text-mutedtext">{t("schoolLabel")}</span>
          <input
            name="school"
            type="text"
            required
            maxLength={120}
            placeholder={t("schoolPlaceholder")}
            className={input}
            disabled={pending}
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" size="lg" className="w-full rounded-full sm:w-auto" disabled={pending}>
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Plus className="h-4 w-4" strokeWidth={1.5} aria-hidden />
          )}
          {pending ? t("creating") : t("create")}
        </Button>
        {state && !state.ok && (
          <p role="alert" className="text-sm font-semibold text-destructive">
            {t(state.error)}
          </p>
        )}
        {state?.ok && state.joinCode && (
          <p className="text-sm text-mutedtext">
            {t("codeLabel")}:{" "}
            <span dir="ltr" className="font-mono text-sm font-bold tracking-[0.22em] text-heading">
              {state.joinCode}
            </span>
          </p>
        )}
      </div>
    </form>
  );
}
