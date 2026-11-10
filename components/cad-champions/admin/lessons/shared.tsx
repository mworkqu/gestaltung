"use client";

import * as React from "react";
import { useTranslations } from "next-intl";

import { Alert, Button } from "@/components/cad-champions/ui";
import { Ltr } from "@/lib/cad-champions/ltr";

// Small pieces shared by the training-content and help-center admin forms.

export type SaveFailure = { error: string; detail?: string } | null;

/** Error alert for a failed admin action: the mapped message plus the fields that were not valid. */
export function FormError({ failure }: { failure: SaveFailure }) {
  const tc = useTranslations("CC.admin.common");
  if (!failure) return null;
  const fields = (failure.detail ?? "").split(",").filter(Boolean);
  return (
    <Alert tone="error" title={tc(`errors.${failure.error}`)}>
      {fields.length ? (
        <p>
          <Ltr>{fields.join(", ")}</Ltr>
        </p>
      ) : null}
    </Alert>
  );
}

export function fieldHasError(failure: SaveFailure, field: string): boolean {
  return !!failure?.detail?.split(",").includes(field);
}

export function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="neu space-y-4 p-5 sm:p-6">
      <div>
        <h2 className="title-card">{title}</h2>
        {hint ? <p className="mt-1 text-sm text-mutedtext">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** Sticky bottom bar with the one Save button of a form. */
export function SaveBar({ saving, label, savingLabel, extra }: { saving: boolean; label: string; savingLabel: string; extra?: React.ReactNode }) {
  return (
    <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface/95 px-4 py-3 backdrop-blur">
      <div className="flex flex-wrap items-center gap-3">{extra}</div>
      <Button type="submit" loading={saving} loadingText={savingLabel}>
        {label}
      </Button>
    </div>
  );
}

export const selectCls =
  "min-h-11 w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
