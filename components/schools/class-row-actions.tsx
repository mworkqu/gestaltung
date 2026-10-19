"use client";

// Archive / reopen one class (3a). A plain update through the server action;
// RLS (school_classes_update) restricts it to the owning teacher. Archiving
// frees a slot against the 20-open-classes limit and never deletes anything.

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Archive, ArchiveRestore, Check, Copy, Loader2 } from "lucide-react";

import { setClassArchived, type ClassActionError } from "@/app/[locale]/schools/classes/actions";

export function ClassRowActions({
  locale,
  classId,
  archived,
}: {
  locale: string;
  classId: string;
  archived: boolean;
}) {
  const t = useTranslations("SchoolClasses");
  const [pending, start] = useTransition();
  const [error, setError] = useState<ClassActionError | null>(null);

  const toggle = () =>
    start(async () => {
      setError(null);
      const res = await setClassArchived(locale, classId, !archived);
      if (!res.ok) setError(res.error);
    });

  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-mutedtext hover:text-heading disabled:opacity-60"
      >
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : archived ? (
          <ArchiveRestore className="h-4 w-4" strokeWidth={1.5} aria-hidden />
        ) : (
          <Archive className="h-4 w-4" strokeWidth={1.5} aria-hidden />
        )}
        {archived ? t("unarchive") : t("archive")}
      </button>
      {archived && <span className="text-xs text-mutedtext">{t("archived")}</span>}
      {error && (
        <span role="alert" className="text-xs font-semibold text-destructive">
          {t(error)}
        </span>
      )}
    </span>
  );
}

/**
 * "Copy code" on the class page. Lives here rather than in its own file
 * because it is the same one-button-one-action shape, and the class page needs
 * exactly one client component for it.
 */
export function CopyCodeButton({ code }: { code: string }) {
  const t = useTranslations("SchoolClasses");
  const [done, setDone] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setDone(true);
      window.setTimeout(() => setDone(false), 2000);
    } catch {
      // No clipboard permission: the code is printed next to the button anyway.
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-cobalt hover:text-cobalt-hover"
    >
      {done ? <Check className="h-4 w-4" strokeWidth={1.5} aria-hidden /> : <Copy className="h-4 w-4" strokeWidth={1.5} aria-hidden />}
      {done ? t("copied") : t("copyCode")}
    </button>
  );
}
