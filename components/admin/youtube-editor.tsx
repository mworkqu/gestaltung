"use client";

// YouTube links (P4-05, store_settings.youtube from migration 0059). The owner
// edits the channel link and up to 12 videos here: a pasted video link or id,
// titles in both languages and optional store search words. Save validates with
// the same rules the storefront reads (lib/youtube.ts) in a super_admin server
// action, upserts the row and calls revalidateStorefront(); errors come back per
// row and field. Links only: nothing here embeds or loads anything from YouTube.

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";

import { saveYoutube } from "@/app/[locale]/dashboard/store/youtube/actions";
import {
  emptyVideoDraft,
  extractVideoId,
  KIT_QUERY_MAX,
  TITLE_MAX,
  validateYoutube,
  videoUrl,
  YOUTUBE_MAX,
  type YoutubeDraft,
  type YoutubeDraftVideo,
  type YoutubeError,
} from "@/lib/youtube";

const input =
  "w-full rounded-lg border border-white/60 bg-surface px-3 py-2 text-sm text-heading shadow-neu-inset outline-none focus:ring-2 focus:ring-cobalt/60";
const invalid = "ring-2 ring-destructive/60";

type Row = { key: number; draft: YoutubeDraftVideo };

export function YoutubeEditor({ locale, initial }: { locale: string; initial: YoutubeDraft }) {
  const t = useTranslations("Youtube");
  const router = useRouter();
  const nextKey = useRef(initial.videos.length);
  const [channel, setChannel] = useState(initial.channel_url);
  const [rows, setRows] = useState<Row[]>(() => initial.videos.map((draft, key) => ({ key, draft })));
  const [errors, setErrors] = useState<YoutubeError[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const patch = (key: number, name: keyof YoutubeDraftVideo, value: string) => {
    setRows((all) => all.map((r) => (r.key === key ? { ...r, draft: { ...r.draft, [name]: value } } : r)));
    setMsg(null);
  };
  const add = () => {
    nextKey.current += 1;
    const key = nextKey.current;
    setRows((all) => [...all, { key, draft: emptyVideoDraft() }]);
    setMsg(null);
  };
  const remove = (key: number) => {
    setRows((all) => all.filter((r) => r.key !== key));
    setErrors([]);
    setMsg(null);
  };

  const rowCodes = (index: number) => errors.filter((e) => e.index === index).map((e) => e.code);
  const channelBad = errors.some((e) => e.index === -1 && e.code === "channel_url");
  // Errors that belong to no field (too many rows, unreadable list).
  const generalCodes = errors.filter((e) => e.index >= YOUTUBE_MAX).map((e) => e.code);

  const current = (): YoutubeDraft => ({ channel_url: channel, videos: rows.map((r) => r.draft) });

  const save = () =>
    start(async () => {
      const draft = current();
      // Same rules as the server: show the problems without a round trip.
      const local = validateYoutube(draft);
      if (!local.ok) {
        setErrors(local.errors);
        setMsg(t("adminFixErrors"));
        return;
      }
      const r = await saveYoutube(locale, draft);
      if (!r.ok) {
        setErrors(r.errors);
        setMsg(r.errors.length ? t("adminFixErrors") : r.message === "forbidden" ? t("adminForbidden") : t("adminFailed"));
        return;
      }
      setErrors([]);
      setMsg(t("adminSaved", { count: r.count }));
      router.refresh();
    });

  const field = (
    row: Row,
    index: number,
    name: keyof YoutubeDraftVideo,
    label: string,
    opts: { ltr?: boolean; placeholder?: string; max?: number; hint?: string; count?: boolean } = {},
  ) => {
    const bad = rowCodes(index).includes(name) || (name === "id" && rowCodes(index).includes("duplicate_id"));
    const id = `yt-${row.key}-${name}`;
    const value = row.draft[name];
    return (
      <div className="min-w-0 space-y-1">
        <label htmlFor={id} className="block text-xs font-medium text-body">
          {label}
        </label>
        <input
          id={id}
          value={value}
          onChange={(e) => patch(row.key, name, e.target.value)}
          dir={opts.ltr ? "ltr" : undefined}
          placeholder={opts.placeholder}
          aria-invalid={bad || undefined}
          className={`${input} ${bad ? invalid : ""}`}
        />
        {opts.count && opts.max ? (
          <p className="text-xs text-mutedtext">{t("fieldCount", { n: value.length, max: opts.max })}</p>
        ) : null}
        {opts.hint && <p className="text-xs text-mutedtext">{opts.hint}</p>}
      </div>
    );
  };

  return (
    <div className="neu space-y-4 p-6">
      <div>
        <h2 className="text-lg font-bold text-heading">{t("adminTitle")}</h2>
        <p className="mt-1 max-w-3xl text-xs text-mutedtext">{t("adminHelp")}</p>
      </div>

      <div className="min-w-0 space-y-1">
        <label htmlFor="yt-channel" className="block text-xs font-medium text-body">
          {t("fieldChannel")}
        </label>
        <input
          id="yt-channel"
          type="url"
          inputMode="url"
          value={channel}
          onChange={(e) => {
            setChannel(e.target.value);
            setMsg(null);
          }}
          dir="ltr"
          placeholder="https://www.youtube.com/@yourhandle"
          aria-invalid={channelBad || undefined}
          className={`${input} ${channelBad ? invalid : ""}`}
        />
        <p className="text-xs text-mutedtext">{t("fieldChannelHint")}</p>
        {channelBad && (
          <p className="text-sm text-destructive" role="alert">
            {t("err_channel_url")}
          </p>
        )}
      </div>

      {rows.length === 0 && <p className="text-sm text-mutedtext">{t("adminEmpty")}</p>}

      <div className="space-y-4">
        {rows.map((row, index) => {
          const d = row.draft;
          const codes = rowCodes(index);
          const rowName = d.title_en.trim() || t("adminRow", { n: index + 1 });
          const id = extractVideoId(d.id);
          return (
            <fieldset key={row.key} className="tile min-w-0 space-y-3">
              <legend className="sr-only">{rowName}</legend>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-heading">{rowName}</p>
                <div className="flex items-center gap-3">
                  {id && (
                    <a
                      href={videoUrl(id)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center text-sm font-medium text-cobalt hover:text-cobalt-hover max-md:min-h-11"
                    >
                      {t("adminViewVideo")}
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => remove(row.key)}
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-mutedtext hover:text-destructive max-md:min-h-11"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                    {t("adminRemove")}
                  </button>
                </div>
              </div>

              {field(row, index, "id", t("fieldId"), {
                ltr: true,
                placeholder: "https://www.youtube.com/watch?v=…",
                hint: t("fieldIdHint"),
              })}
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {field(row, index, "title_en", t("fieldTitleEn"), { max: TITLE_MAX, count: true })}
                {field(row, index, "title_ar", t("fieldTitleAr"), { max: TITLE_MAX, count: true })}
              </div>
              {field(row, index, "kit_query", t("fieldKit"), {
                max: KIT_QUERY_MAX,
                count: true,
                hint: t("fieldKitHint"),
              })}

              {codes.length > 0 && (
                <ul className="space-y-0.5 text-sm text-destructive" role="alert">
                  {codes.map((code) => (
                    <li key={code}>{t(`err_${code}`)}</li>
                  ))}
                </ul>
              )}
            </fieldset>
          );
        })}
      </div>

      {generalCodes.length > 0 && (
        <ul className="space-y-0.5 text-sm text-destructive" role="alert">
          {[...new Set(generalCodes)].map((code) => (
            <li key={code}>{t(`err_${code}`)}</li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={add}
          disabled={rows.length >= YOUTUBE_MAX}
          className="inline-flex items-center gap-1.5 rounded-full border border-borderstrong px-3 py-1.5 text-sm font-medium text-heading hover:border-cobalt hover:text-cobalt disabled:opacity-50 max-md:min-h-11"
        >
          <Plus className="h-4 w-4" aria-hidden />
          {t("adminAdd")}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={save}
          className="inline-flex items-center gap-1.5 rounded-full bg-cobalt px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50 max-md:min-h-11"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
          {t("adminSave")}
        </button>
        {msg && (
          <span className="text-sm text-mutedtext" aria-live="polite">
            {msg}
          </span>
        )}
      </div>
    </div>
  );
}
