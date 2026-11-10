"use client";

import * as React from "react";
import { MessageSquareText } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { askGradeQuery } from "@/app/[locale]/cad-champions/results/[attemptId]/actions";
import { Button, useToast } from "@/components/cad-champions/ui";

const MAX = 2000;

/** "Question this result": a short inline form (no dialog) that files a grade query. */
export function QuestionForm({ attemptId, taskResultId, alreadyAsked }: { attemptId: string; taskResultId: string; alreadyAsked: boolean }) {
  const t = useTranslations("CC.results.tasks.ask");
  const locale = useLocale();
  const toast = useToast();
  const id = React.useId();
  const [open, setOpen] = React.useState(false);
  const [body, setBody] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [sent, setSent] = React.useState(alreadyAsked);
  const [pending, startTransition] = React.useTransition();

  if (sent) {
    return (
      <p className="flex items-start gap-2 text-sm text-body" role="status">
        <MessageSquareText aria-hidden="true" strokeWidth={1.75} className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
        {alreadyAsked ? t("already") : t("sent")}
      </p>
    );
  }

  if (!open) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <MessageSquareText aria-hidden="true" strokeWidth={1.75} className="h-4 w-4" />
        {t("open")}
      </Button>
    );
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = body.trim();
    if (!text) return setError(t("errorEmpty"));
    if (text.length > MAX) return setError(t("errorTooLong"));
    setError(null);
    startTransition(async () => {
      const res = await askGradeQuery({ attemptId, taskResultId, body: text, locale });
      if (res.ok || res.error === "already") {
        setSent(true);
        toast.success(t("toast"));
        return;
      }
      setError(res.error === "empty" ? t("errorEmpty") : res.error === "too_long" ? t("errorTooLong") : t("error"));
    });
  }

  return (
    <form onSubmit={submit} className="neu-inset space-y-3 p-4" noValidate>
      <label htmlFor={`${id}-body`} className="block text-sm font-bold text-ink">
        {t("label")}
      </label>
      <p id={`${id}-hint`} className="text-xs text-body">
        {t("hint")}
      </p>
      <textarea
        id={`${id}-body`}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={4}
        maxLength={MAX + 200}
        aria-describedby={`${id}-hint${error ? ` ${id}-error` : ""}`}
        aria-invalid={error ? true : undefined}
        className="w-full rounded-xl border border-border bg-surface p-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      />
      {error ? (
        <p id={`${id}-error`} className="text-sm font-semibold text-[#a1231f]" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" loading={pending} loadingText={t("sending")}>
          {t("send")}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={pending}>
          {t("cancel")}
        </Button>
      </div>
    </form>
  );
}
