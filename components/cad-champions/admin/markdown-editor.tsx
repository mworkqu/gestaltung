"use client";

import * as React from "react";
import { Film } from "lucide-react";
import { useTranslations } from "next-intl";

import { parseHelpMarkdown, type HelpBlock } from "@/lib/cad-champions/help/markdown";
import type { Inline } from "@/lib/legal/markdown";
import { cn } from "@/lib/utils";

import { textareaCls } from "./fields";

// Markdown editor with a live preview (Prompt 11): the same safe reader as
// the Help Center and lesson notes (lib/cad-champions/help/markdown.ts), no
// raw HTML. English and Arabic are edited side by side; each preview renders
// in its own direction (EN ltr, AR rtl). Links are shown, not followed.

function Inlines({ nodes }: { nodes: Inline[] }) {
  return (
    <>
      {nodes.map((n, i) =>
        n.type === "text" ? (
          <React.Fragment key={i}>{n.value}</React.Fragment>
        ) : n.type === "bold" ? (
          <strong key={i} className="font-semibold text-heading">
            <Inlines nodes={n.children} />
          </strong>
        ) : (
          <span key={i} title={n.href} className="text-accent underline underline-offset-2">
            <Inlines nodes={n.children} />
          </span>
        ),
      )}
    </>
  );
}

function PreviewBlock({ block, videoLabel }: { block: HelpBlock; videoLabel: string }) {
  switch (block.type) {
    case "heading":
      return block.level <= 2 ? (
        <h2 className="mt-4 text-lg font-bold text-heading">
          <Inlines nodes={block.children} />
        </h2>
      ) : (
        <h3 className="mt-3 text-base font-bold text-heading">
          <Inlines nodes={block.children} />
        </h3>
      );
    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag className={cn("space-y-1 ps-5", block.ordered ? "list-decimal" : "list-disc")}>
          {block.items.map((it, i) => (
            <li key={i}>
              <Inlines nodes={it} />
            </li>
          ))}
        </Tag>
      );
    }
    case "table":
      return (
        <div className="overflow-x-auto">
          {/* no-scroll: wrapper above */}
          <table className="w-full text-start text-xs">
            <thead>
              <tr>
                {block.head.map((c, i) => (
                  <th key={i} className="border-b border-border p-1 text-start font-semibold">
                    <Inlines nodes={c} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => (
                    <td key={j} className="border-b border-border p-1">
                      <Inlines nodes={c} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "image":
      return <p className="rounded-lg bg-panel px-3 py-2 text-xs text-mutedtext">{`[${block.alt || "image"}] ${block.src}`}</p>;
    case "quote":
      return (
        <blockquote className="border-s-4 border-accent ps-3 text-body">
          <Inlines nodes={block.children} />
        </blockquote>
      );
    case "video":
      return (
        <p className="flex items-center gap-2 rounded-lg bg-panel px-3 py-2 text-xs text-mutedtext">
          <Film aria-hidden="true" className="h-4 w-4" />
          {videoLabel}
        </p>
      );
    default:
      return (
        <p>
          <Inlines nodes={block.children} />
        </p>
      );
  }
}

export function MarkdownPreview({ source, lang }: { source: string; lang: "en" | "ar" }) {
  const t = useTranslations("CC.admin.common");
  const blocks = React.useMemo(() => parseHelpMarkdown(source ?? ""), [source]);
  return (
    <div lang={lang} dir={lang === "ar" ? "rtl" : "ltr"} className="neu-inset min-h-24 space-y-2 overflow-hidden p-4 text-sm leading-relaxed text-body">
      {blocks.length === 0 ? <p className="text-mutedtext">{t("previewEmpty")}</p> : blocks.map((b, i) => <PreviewBlock key={i} block={b} videoLabel={t("previewVideo")} />)}
    </div>
  );
}

type Side = { name?: string; value: string; onChange: (v: string) => void };

/**
 * Bilingual markdown editor: two textareas with a live preview under each
 * (EN rendered left-to-right, AR right-to-left). Controlled; when `name`s are
 * given, hidden inputs carry the values in a form post.
 */
export function BilingualMarkdownEditor({ label, hint, en, ar, rows = 10 }: { label: string; hint?: string; en: Side; ar: Side; rows?: number }) {
  const t = useTranslations("CC.admin.common");
  const id = React.useId();
  const [showPreview, setShowPreview] = React.useState(true);
  const side = (s: Side, lang: "en" | "ar") => (
    <div className="flex min-w-0 flex-col gap-2">
      <label htmlFor={`${id}-${lang}`} className="text-xs font-semibold uppercase tracking-wide text-mutedtext rtl:normal-case rtl:tracking-normal">
        {lang === "ar" ? t("arabic") : t("english")}
      </label>
      <textarea
        id={`${id}-${lang}`}
        name={s.name}
        lang={lang}
        dir={lang === "ar" ? "rtl" : "ltr"}
        rows={rows}
        value={s.value}
        onChange={(e) => s.onChange(e.target.value)}
        className={cn(textareaCls, "font-mono text-xs")}
      />
      {showPreview ? <MarkdownPreview source={s.value} lang={lang} /> : null}
    </div>
  );
  return (
    <fieldset className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <legend className="text-sm font-semibold text-ink">{label}</legend>
        <button
          type="button"
          onClick={() => setShowPreview((v) => !v)}
          className="min-h-11 rounded-full px-3 text-xs font-semibold text-accent hover:bg-panel focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          aria-pressed={showPreview}
        >
          {showPreview ? t("hidePreview") : t("showPreview")}
        </button>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {side(en, "en")}
        {side(ar, "ar")}
      </div>
      {hint ? <p className="text-xs text-mutedtext">{hint}</p> : null}
    </fieldset>
  );
}
