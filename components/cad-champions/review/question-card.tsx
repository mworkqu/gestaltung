"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { answerQuestionAction, setQuestionPublicAction } from "@/app/[locale]/cad-champions/admin/questions/actions";
import { Button, HelpTip, StatusChip, useToast } from "@/components/cad-champions/ui";
import type { Locale } from "@/i18n/routing";
import { formatDateTime } from "@/lib/cad-champions/format";
import type { QuestionView } from "@/lib/cad-champions/questions/server";

const MAX = 4000;

/** One question in the inbox: the student's text, a reply box, and "Show to everyone" for lesson questions. */
export function QuestionCard({ q }: { q: QuestionView }) {
  const t = useTranslations("CC.review.questions");
  const locale = useLocale() as Locale;
  const toast = useToast();
  const router = useRouter();
  const id = React.useId();
  const [answer, setAnswer] = React.useState(q.answer ?? "");
  const [editing, setEditing] = React.useState(q.status === "open");
  const [error, setError] = React.useState<string | null>(null);
  const [isPublic, setIsPublic] = React.useState(q.isPublic);
  const [pending, startTransition] = React.useTransition();
  const [togglePending, startToggle] = React.useTransition();

  function send(e: React.FormEvent) {
    e.preventDefault();
    const text = answer.trim();
    if (!text) return setError(t("reply.empty"));
    if (text.length > MAX) return setError(t("reply.tooLong"));
    setError(null);
    startTransition(async () => {
      const res = await answerQuestionAction({ questionId: q.id, answer: text });
      if (res.ok) {
        toast.success(t("reply.sent"), res.emailed ? t("reply.sentEmail") : t("reply.sentNoEmail"));
        setEditing(false);
        router.refresh();
        return;
      }
      setError(res.error === "empty" ? t("reply.empty") : res.error === "too_long" ? t("reply.tooLong") : t("reply.error"));
    });
  }

  function togglePublic(next: boolean) {
    startToggle(async () => {
      const res = await setQuestionPublicAction({ questionId: q.id, isPublic: next });
      if (res.ok) {
        setIsPublic(next);
        toast.success(next ? t("public.on") : t("public.off"));
      } else {
        toast.error(res.error === "not_answered" ? t("public.needsAnswer") : t("public.error"));
      }
    });
  }

  return (
    <article className="neu space-y-4 p-5" aria-labelledby={`${id}-h`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 id={`${id}-h`} className="font-extrabold text-heading">
            {q.studentName || t("unknownStudent")}
          </h3>
          <p className="text-xs text-body">
            {t(`kind.${q.kind}`)}
            {q.context ? ` · ${q.context}` : ""}
            {" · "}
            {t("asked", { when: formatDateTime(q.createdAt, locale) })}
            {" · "}
            {t(`lang.${q.locale}`)}
          </p>
        </div>
        <StatusChip tone={q.status === "open" ? "warning" : "success"}>{t(`status.${q.status}`)}</StatusChip>
      </div>

      <blockquote dir="auto" className="tile whitespace-pre-line text-sm text-ink">
        {q.body}
      </blockquote>

      <div className="flex flex-wrap gap-3 text-sm">
        <Link href={q.href} target="_blank" className="inline-flex min-h-11 items-center gap-1 font-semibold text-accent underline-offset-2 hover:underline">
          <ExternalLink aria-hidden="true" strokeWidth={1.75} className="h-4 w-4 rtl:-scale-x-100" />
          {q.kind === "grade_query" ? t("openResult") : t("openTraining")}
        </Link>
        {q.reviewHref ? (
          <Link href={q.reviewHref} className="inline-flex min-h-11 items-center font-semibold text-accent underline-offset-2 hover:underline">
            {t("openReview")}
          </Link>
        ) : null}
      </div>

      {editing ? (
        <form onSubmit={send} className="space-y-3" noValidate>
          <label htmlFor={`${id}-a`} className="block text-sm font-bold text-ink">
            {t("reply.label")}
          </label>
          <p id={`${id}-hint`} className="text-xs text-body">
            {t("reply.hint")}
          </p>
          <textarea
            id={`${id}-a`}
            dir="auto"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            rows={4}
            maxLength={MAX + 200}
            aria-describedby={`${id}-hint${error ? ` ${id}-err` : ""}`}
            aria-invalid={error ? true : undefined}
            className="w-full rounded-xl border border-border bg-surface p-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
          {error ? (
            <p id={`${id}-err`} role="alert" className="text-sm font-semibold text-[#a1231f]">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" loading={pending} loadingText={t("reply.sending")}>
              {q.status === "answered" ? t("reply.update") : t("reply.send")}
            </Button>
            {q.status === "answered" ? (
              <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={pending}>
                {t("reply.cancel")}
              </Button>
            ) : null}
          </div>
        </form>
      ) : (
        <div className="space-y-2">
          <h4 className="text-sm font-bold text-ink">{t("answerTitle")}</h4>
          <p dir="auto" className="whitespace-pre-line text-sm text-body">
            {q.answer}
          </p>
          {q.answeredAt ? <p className="text-xs text-body">{t("answeredAt", { when: formatDateTime(q.answeredAt, locale) })}</p> : null}
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(true)}>
            {t("reply.edit")}
          </Button>
        </div>
      )}

      {q.kind === "lesson" ? (
        <label className="flex min-h-11 items-center gap-2 text-sm font-semibold text-ink">
          <input
            type="checkbox"
            checked={isPublic}
            disabled={togglePending || q.status !== "answered"}
            onChange={(e) => togglePublic(e.target.checked)}
            className="h-5 w-5"
          />
          {t("public.label")}
          <HelpTip label={t("public.helpLabel")}>{t("public.help")}</HelpTip>
        </label>
      ) : null}
    </article>
  );
}
