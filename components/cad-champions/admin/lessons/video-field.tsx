"use client";

import * as React from "react";
import { Play } from "lucide-react";
import { useTranslations } from "next-intl";

import { hintCls, inputCls, labelCls } from "@/components/cad-champions/admin/fields";
import { Button, Spinner } from "@/components/cad-champions/ui";
import { validateVideoId } from "@/lib/cad-champions/admin/lessons";
import { cn } from "@/lib/utils";

// One lesson video slot: the stored id (YouTube "youtube:<id>" or a Bunny
// GUID), a live format check and a preview player. The preview asks the real
// student route GET /api/cad-champions/video/lesson:<slug>:<slot>, which
// reads the SAVED value (staff pass its access check), so the preview works
// only when the field equals what is saved.

export function VideoField({
  label,
  slot,
  lessonSlug,
  value,
  savedValue,
  onChange,
  invalid,
}: {
  label: string;
  /** e.g. inventor_en */
  slot: string;
  /** The saved slug (the route looks the lesson up by it). */
  lessonSlug: string;
  value: string;
  savedValue: string;
  onChange: (v: string) => void;
  invalid?: boolean;
}) {
  const t = useTranslations("CC.admin.lessons");
  const [embed, setEmbed] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const check = validateVideoId(value);
  const dirty = value.trim() !== savedValue.trim();
  const hasValue = value.trim() !== "";

  React.useEffect(() => {
    setEmbed(null);
    setError(null);
  }, [savedValue]);

  async function preview() {
    setLoading(true);
    setError(null);
    setEmbed(null);
    try {
      const res = await fetch(`/api/cad-champions/video/${encodeURIComponent(`lesson:${lessonSlug}:${slot}`)}`, { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as { embedUrl?: string; error?: string };
      if (res.ok && body.embedUrl) setEmbed(body.embedUrl);
      else setError(["signed_out", "forbidden", "not_found", "no_video", "not_configured"].includes(body.error ?? "") ? (body.error as string) : "error");
    } catch {
      setError("error");
    } finally {
      setLoading(false);
    }
  }

  const id = `video-${slot}`;
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-2xl border border-border p-3">
      <label htmlFor={id} className={labelCls}>
        <span>{label}</span>
      </label>
      <input
        id={id}
        dir="ltr"
        lang="en"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        autoComplete="off"
        placeholder={t("video.placeholder")}
        aria-invalid={!check.ok || invalid ? true : undefined}
        className={cn(inputCls, "font-mono text-xs", (!check.ok || invalid) && "border-[#a1231f]")}
      />
      <p className={cn(hintCls, !check.ok && "text-[#a1231f]")} role={check.ok ? undefined : "alert"}>
        {!hasValue ? t("video.empty") : !check.ok ? t("video.invalid") : check.provider === "youtube" ? t("video.youtube") : t("video.bunny")}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={preview}
          loading={loading}
          loadingText={t("video.loading")}
          disabled={!hasValue || !check.ok || dirty || !savedValue.trim()}
          disabledReason={dirty && hasValue ? t("video.saveFirst") : t("video.nothingToPreview")}
        >
          <Play aria-hidden="true" className="h-4 w-4" />
          {t("video.preview")}
        </Button>
        {loading ? <Spinner label={t("video.loading")} /> : null}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-[#a1231f]">
          {t(`video.errors.${error}`)}
        </p>
      ) : null}
      {embed ? (
        <div className="aspect-video w-full overflow-hidden rounded-xl bg-black">
          <iframe
            src={embed}
            title={label}
            className="h-full w-full"
            allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
      ) : null}
    </div>
  );
}
