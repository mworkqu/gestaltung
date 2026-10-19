"use client";

// A teacher's remark on a team project (3b). The insert happens in the
// addTeamComment server action (author_id = the caller, RLS checks they teach
// this class); students read the comment in their own workspace. 1–2000
// characters, checked here and again on the server.

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { addTeamComment, type ClassActionResult } from "@/app/[locale]/schools/classes/actions";

export const COMMENT_MAX = 2000;

type State = ClassActionResult | null;

export function TeamCommentForm({ locale, teamId }: { locale: string; teamId: string }) {
  const t = useTranslations("SchoolClasses");
  const [state, formAction, pending] = useActionState<State, FormData>(
    async (_prev, formData) => addTeamComment(locale, teamId, String(formData.get("body") ?? "")),
    null,
  );

  return (
    <form action={formAction} className="space-y-4">
      <label className="block space-y-1.5">
        <span className="sr-only">{t("commentHeading")}</span>
        <textarea
          name="body"
          required
          rows={3}
          maxLength={COMMENT_MAX}
          placeholder={t("commentPlaceholder")}
          className="w-full rounded-lg border border-white/60 bg-surface px-3 py-2 text-sm leading-relaxed text-heading shadow-neu-inset outline-none focus:ring-2 focus:ring-cobalt/60"
          disabled={pending}
        />
      </label>
      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" size="lg" className="w-full rounded-full sm:w-auto" disabled={pending}>
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Send className="h-4 w-4" strokeWidth={1.5} aria-hidden />
          )}
          {pending ? t("commentSending") : t("commentSend")}
        </Button>
        {state && !state.ok && (
          <p role="alert" className="text-sm font-semibold text-destructive">
            {t(state.error)}
          </p>
        )}
      </div>
    </form>
  );
}
