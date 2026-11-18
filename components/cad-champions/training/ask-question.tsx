"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";

import { UploadBox, type UploadedFile } from "@/components/cad-champions/upload/upload-box";
import { Button, useToast } from "@/components/cad-champions/ui";
import { askLessonQuestionAction } from "@/lib/cad-champions/training/actions";
import { QUESTION_IMAGE_MAX_BYTES, QUESTION_MAX } from "@/lib/cad-champions/training/catalog";

/** "Ask a question about this lesson": text + optional screenshot -> admin questions inbox. */
export function AskQuestion({ slug, userId }: { slug: string; userId: string }) {
  const t = useTranslations("CC.training.ask");
  const locale = useLocale();
  const router = useRouter();
  const toast = useToast();
  const id = React.useId();
  const [body, setBody] = React.useState("");
  const [image, setImage] = React.useState<UploadedFile | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = body.trim();
    if (!text) return setError(t("errors.empty"));
    if (text.length > QUESTION_MAX) return setError(t("errors.too_long"));
    setError(null);
    startTransition(async () => {
      const res = await askLessonQuestionAction({ slug, body: text, imagePath: image?.path ?? null, locale });
      if (res.ok) {
        setBody("");
        setImage(null);
        toast.success(t("sent"));
        router.refresh();
        return;
      }
      const key = res.error === "signed_out" || res.error === "not_found" ? "error" : res.error;
      setError(t(`errors.${key}`));
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      <label htmlFor={`${id}-q`} className="block text-sm font-semibold text-ink">
        {t("label")}
      </label>
      <textarea
        id={`${id}-q`}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={4}
        maxLength={QUESTION_MAX}
        placeholder={t("placeholder")}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-err` : undefined}
        className="w-full rounded-xl border border-border bg-surface p-3 text-base text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      />
      <UploadBox
        accept="image"
        maxBytes={QUESTION_IMAGE_MAX_BYTES}
        bucket="cc-submissions"
        pathPrefix={`${userId}/questions/`}
        label={t("image")}
        onUploaded={(f) => setImage(f)}
        onBusyChange={setBusy}
        current={image ? { fileName: image.fileName, size: image.size } : null}
      />
      {error ? (
        <p id={`${id}-err`} role="alert" className="text-sm font-semibold text-[#a1231f]">
          {error}
        </p>
      ) : null}
      <Button type="submit" loading={pending} loadingText={t("sending")} disabled={busy}>
        {t("submit")}
      </Button>
    </form>
  );
}
