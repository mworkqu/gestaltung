"use client";

// Videos & YouTube (D6). The six feature clips from the public `videos` bucket:
// poster, length, size, Download MP4 and copy title / description (the
// always-working fallback), the YouTube link once uploaded, and — when the
// channel is connected — an editable title / description / tags / privacy form
// with "Upload to YouTube" (POST /api/admin/youtube/upload, server-side
// resumable upload). Connect = GET /api/admin/youtube/connect (Google OAuth);
// Disconnect = disconnectYoutube() server action. No token ever reaches here.

import { Hint } from "@/components/ui/hint";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Check, Copy, Download, ExternalLink, Film, Link2, Loader2, Unlink, Upload } from "lucide-react";

import { disconnectYoutube } from "@/app/[locale]/dashboard/store/youtube/actions";
import { formatFileSize } from "@/lib/format-bytes";
import { videoUrl } from "@/lib/youtube";
import {
  PRIVACY,
  splitTags,
  tagsLength,
  validateUploadMeta,
  YT_TAGS_MAX_CHARS,
  YT_TITLE_MAX,
  type MetaError,
  type Privacy,
  type UploadMeta,
  type UploadRecord,
} from "@/lib/youtube-upload";

export type ClipView = {
  slug: string;
  title: string;
  poster: string;
  download: string;
  durationSeconds: number;
  sizeBytes: number | null;
  defaults: UploadMeta;
  upload: UploadRecord | null;
};

export type QuotaView = { used: number; remaining: number; uploadsLeft: number; resetHourQatar: number };

export type ConnectionView =
  | { state: "migration" }
  | { state: "error" }
  | { state: "setup"; missing: string[] }
  | { state: "connected" | "disconnected"; channel: string; quota: QuotaView };

const input =
  "w-full rounded-lg border border-white/60 bg-surface px-3 py-2 text-sm text-heading shadow-neu-inset outline-none focus:ring-2 focus:ring-cobalt/60";
const invalid = "ring-2 ring-destructive/60";
const softBtn =
  "inline-flex items-center gap-1.5 rounded-full border border-borderstrong px-3 py-1.5 text-sm font-medium text-heading hover:border-cobalt hover:text-cobalt disabled:opacity-50 max-md:min-h-11";
const primaryBtn =
  "inline-flex items-center gap-1.5 rounded-full bg-cobalt px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50 max-md:min-h-11";

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s) % 60).padStart(2, "0")}`;

/** Short "?" hint (shared components/ui/hint.tsx: hover, tap and keyboard). */
function QHint({ text, label }: { text: string; label: string }) {
  return <Hint label={text} triggerLabel={label} />;
}

export function VideosYoutube({
  locale,
  clips,
  connection,
  flash,
  uploadCost,
  dailyQuota,
}: {
  locale: string;
  clips: ClipView[];
  connection: ConnectionView;
  flash: string | null;
  uploadCost: number;
  dailyQuota: number;
}) {
  const t = useTranslations("VideosYoutube");
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(() => {
    if (!flash) return null;
    const key = flash === "connected" ? "flash_connected" : flash;
    return t.has(key) ? t(key) : t("error_google");
  });
  const [pending, start] = useTransition();
  const connected = connection.state === "connected";
  const quota = connection.state === "connected" || connection.state === "disconnected" ? connection.quota : null;

  const disconnect = () => {
    if (!window.confirm(t("disconnectConfirm"))) return;
    start(async () => {
      const r = await disconnectYoutube(locale);
      setMsg(r.ok ? t("disconnected") : t("disconnectFailed"));
      if (r.ok) router.refresh();
    });
  };

  return (
    <div className="space-y-6">
      <section className="neu space-y-3 p-6" aria-labelledby="yt-channel-heading">
        <h2 id="yt-channel-heading" className="text-lg font-bold text-heading">
          {t("channelTitle")}
        </h2>

        {connection.state === "migration" && <p className="text-sm text-body">{t("migrationMissing")}</p>}
        {connection.state === "error" && (
          <p className="text-sm text-destructive" role="alert">
            {t("loadError")}
          </p>
        )}
        {connection.state === "setup" && (
          <p className="text-sm text-body">
            {t("setupMissing")}{" "}
            <span dir="ltr" className="font-mono text-xs">
              {connection.missing.join(", ")}
            </span>
          </p>
        )}

        {(connection.state === "connected" || connection.state === "disconnected") && (
          <>
            <p className="text-sm text-body">
              {connected
                ? connection.channel
                  ? t("statusConnected", { channel: connection.channel })
                  : t("statusConnectedNoName")
                : t("statusDisconnected")}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              {connected ? (
                <button type="button" onClick={disconnect} disabled={pending} className={softBtn}>
                  {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Unlink className="h-4 w-4" aria-hidden />}
                  {t("disconnect")}
                </button>
              ) : (
                <a href={`/api/admin/youtube/connect?locale=${locale === "ar" ? "ar" : "en"}`} className={primaryBtn}>
                  <Link2 className="h-4 w-4" aria-hidden />
                  {t("connect")}
                </a>
              )}
            </div>
            {quota && (
              <div className="flex flex-wrap items-center gap-2 text-sm text-mutedtext">
                <span>
                  {t("quotaLine", {
                    used: String(quota.used),
                    total: String(dailyQuota),
                    left: String(quota.uploadsLeft),
                  })}{" "}
                  {t("quotaReset", { hour: String(quota.resetHourQatar) })}
                </span>
                <QHint label={t("quotaHintAria")} text={t("quotaHint", { cost: String(uploadCost), total: String(dailyQuota) })} />
              </div>
            )}
          </>
        )}

        <p className="text-xs text-mutedtext">{t("fallbackNote")}</p>
        {msg && (
          <p className="text-sm text-heading" aria-live="polite">
            {msg}
          </p>
        )}
      </section>

      <section className="neu space-y-4 p-6" aria-labelledby="yt-clips-heading">
        <h2 id="yt-clips-heading" className="text-lg font-bold text-heading">
          {t("clipsHeading")}
        </h2>
        <div className="space-y-4">
          {clips.map((c) => (
            <ClipRow key={c.slug} clip={c} locale={locale} connected={connected} quota={quota} uploadCost={uploadCost} />
          ))}
        </div>
      </section>
    </div>
  );
}

function ClipRow({
  clip,
  locale,
  connected,
  quota,
  uploadCost,
}: {
  clip: ClipView;
  locale: string;
  connected: boolean;
  quota: QuotaView | null;
  uploadCost: number;
}) {
  const t = useTranslations("VideosYoutube");
  const router = useRouter();
  const [title, setTitle] = useState(clip.defaults.title);
  const [description, setDescription] = useState(clip.defaults.description);
  const [tagsText, setTagsText] = useState(clip.defaults.tags.join(", "));
  const [privacy, setPrivacy] = useState<Privacy>(clip.defaults.privacy);
  const [addToSite, setAddToSite] = useState(true);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<"title" | "description" | null>(null);
  const [errors, setErrors] = useState<MetaError[]>([]);
  const [result, setResult] = useState<{ ok: boolean; text: string; warnings: string[] } | null>(null);
  const [posterOk, setPosterOk] = useState(true);

  const tags = splitTags(tagsText);
  const canUpload = connected && !!quota && quota.remaining >= uploadCost && !busy && clip.sizeBytes !== null;
  const id = `clip-${clip.slug}`;
  const dateFmt = new Intl.DateTimeFormat(locale === "ar" ? "ar-QA-u-nu-latn" : "en-GB", { dateStyle: "medium" });

  const copy = async (what: "title" | "description") => {
    try {
      await navigator.clipboard.writeText(what === "title" ? title : description);
      setCopied(what);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      setResult({ ok: false, text: t("copyFailed"), warnings: [] });
    }
  };

  const upload = async () => {
    const draft = { title, description, tags, privacy };
    const local = validateUploadMeta(draft);
    if (!local.ok) {
      setErrors(local.errors);
      setResult({ ok: false, text: t("uploadErr_bad_meta"), warnings: [] });
      return;
    }
    setErrors([]);
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/youtube/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: clip.slug, ...local.value, addToSite }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; fields?: MetaError[]; warnings?: string[] };
      if (res.ok && body.ok) {
        setResult({ ok: true, text: t("uploadDone"), warnings: body.warnings ?? [] });
        router.refresh();
      } else {
        if (body.fields) setErrors(body.fields);
        const key = `uploadErr_${body.error ?? "generic"}`;
        setResult({
          ok: false,
          text: t.has(key) ? t(key, { hour: String(quota?.resetHourQatar ?? 10) }) : t("uploadErr_generic"),
          warnings: [],
        });
      }
    } catch {
      setResult({ ok: false, text: t("uploadErr_generic"), warnings: [] });
    } finally {
      setBusy(false);
    }
  };

  const warnings = result?.warnings ?? clip.upload?.warnings ?? [];

  return (
    <article className="tile min-w-0 space-y-3" aria-labelledby={`${id}-title`}>
      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="aspect-video w-full shrink-0 overflow-hidden rounded-xl bg-panel sm:w-48">
          {posterOk ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={clip.poster}
              alt=""
              width={192}
              height={108}
              loading="lazy"
              onError={() => setPosterOk(false)}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-mutedtext">
              <Film className="h-8 w-8" aria-hidden />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <h3 id={`${id}-title`} className="text-base font-bold text-heading">
            {clip.title}
          </h3>
          <p className="text-xs text-mutedtext">
            <span dir="ltr">{mmss(clip.durationSeconds)}</span>
            {clip.sizeBytes !== null ? (
              <>
                {" · "}
                <span dir="ltr">{formatFileSize(clip.sizeBytes)}</span>
              </>
            ) : (
              <>
                {" · "}
                <span className="text-destructive">{t("fileMissing")}</span>
              </>
            )}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <a href={clip.download} download={`${clip.slug}.mp4`} className={softBtn}>
              <Download className="h-4 w-4" aria-hidden />
              {t("download")}
            </a>
            <button type="button" onClick={() => copy("title")} className={softBtn}>
              {copied === "title" ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
              {copied === "title" ? t("copied") : t("copyTitle")}
            </button>
            <button type="button" onClick={() => copy("description")} className={softBtn}>
              {copied === "description" ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
              {copied === "description" ? t("copied") : t("copyDescription")}
            </button>
          </div>
          {clip.upload && (
            <p className="flex flex-wrap items-center gap-2 text-sm text-body">
              <a
                href={videoUrl(clip.upload.video_id)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-medium text-cobalt hover:text-cobalt-hover max-md:min-h-11"
              >
                <ExternalLink className="h-4 w-4" aria-hidden />
                {t("onYoutube")}
              </a>
              <span className="text-xs text-mutedtext">
                {t("uploadedOn", {
                  date: clip.upload.uploaded_at ? dateFmt.format(new Date(clip.upload.uploaded_at)) : "",
                  privacy: t(`privacy_${clip.upload.privacy}`),
                })}
              </span>
            </p>
          )}
        </div>
      </div>

      <details className="group">
        <summary className="cursor-pointer text-sm font-medium text-heading max-md:min-h-11">{t("detailsSummary")}</summary>
        <div className="mt-3 space-y-3">
          <div className="space-y-1">
            <label htmlFor={`${id}-t`} className="block text-xs font-medium text-body">
              {t("fieldTitle")}
            </label>
            <input
              id={`${id}-t`}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={YT_TITLE_MAX}
              aria-invalid={errors.includes("title") || undefined}
              className={`${input} ${errors.includes("title") ? invalid : ""}`}
            />
            <p className="text-xs text-mutedtext">{t("count", { n: String(title.length), max: String(YT_TITLE_MAX) })}</p>
            {errors.includes("title") && <p className="text-sm text-destructive">{t("err_title")}</p>}
          </div>
          <div className="space-y-1">
            <label htmlFor={`${id}-d`} className="block text-xs font-medium text-body">
              {t("fieldDescription")}
            </label>
            <textarea
              id={`${id}-d`}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={9}
              dir="auto"
              aria-invalid={errors.includes("description") || undefined}
              className={`${input} ${errors.includes("description") ? invalid : ""}`}
            />
            {errors.includes("description") && <p className="text-sm text-destructive">{t("err_description")}</p>}
          </div>
          <div className="space-y-1">
            <label htmlFor={`${id}-g`} className="block text-xs font-medium text-body">
              {t("fieldTags")}
            </label>
            <input
              id={`${id}-g`}
              value={tagsText}
              onChange={(e) => setTagsText(e.target.value)}
              dir="auto"
              aria-invalid={errors.includes("tags") || undefined}
              className={`${input} ${errors.includes("tags") ? invalid : ""}`}
            />
            <p className="text-xs text-mutedtext">
              {t("count", { n: String(tagsLength(tags)), max: String(YT_TAGS_MAX_CHARS) })}
            </p>
            {errors.includes("tags") && <p className="text-sm text-destructive">{t("err_tags")}</p>}
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <label htmlFor={`${id}-p`} className="block text-xs font-medium text-body">
                  {t("fieldPrivacy")}
                </label>
                <QHint label={t("privacyHintAria")} text={t("privacyHint")} />
              </div>
              <select
                id={`${id}-p`}
                value={privacy}
                onChange={(e) => setPrivacy(e.target.value as Privacy)}
                className={input}
              >
                {PRIVACY.map((p) => (
                  <option key={p} value={p}>
                    {t(`privacy_${p}`)}
                  </option>
                ))}
              </select>
              <p className="text-xs text-mutedtext">{t("privacyHint")}</p>
            </div>
            <div className="flex items-start gap-2 pt-5">
              <label className="flex items-center gap-2 text-sm text-body">
                <input type="checkbox" checked={addToSite} onChange={(e) => setAddToSite(e.target.checked)} />
                {t("fieldSite")}
              </label>
              <QHint label={t("siteHintAria")} text={t("siteHint")} />
            </div>
          </div>

          {clip.upload && <p className="text-xs text-mutedtext">{t("uploadAgainNote")}</p>}
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={upload} disabled={!canUpload} className={primaryBtn}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Upload className="h-4 w-4" aria-hidden />}
              {clip.upload ? t("uploadAgain") : t("upload")}
            </button>
            {!connected && <span className="text-xs text-mutedtext">{t("uploadNotConnected")}</span>}
            {connected && quota && quota.remaining < uploadCost && (
              <span className="text-xs text-mutedtext">{t("uploadNoQuota", { hour: String(quota.resetHourQatar) })}</span>
            )}
          </div>
          {busy && (
            <p className="text-sm text-body" aria-live="polite">
              {t("uploading")}
            </p>
          )}
        </div>
      </details>

      {(result || warnings.length > 0) && (
        <div aria-live="polite" className="space-y-1">
          {result && <p className={`text-sm ${result.ok ? "text-heading" : "text-destructive"}`}>{result.text}</p>}
          {warnings.length > 0 && (
            <ul className="list-inside list-disc text-sm text-mutedtext">
              {warnings.map((w) => (
                <li key={w}>{t.has(`warn_${w}`) ? t(`warn_${w}`) : t("warn_site")}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </article>
  );
}
