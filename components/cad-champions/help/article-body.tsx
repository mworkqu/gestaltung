import Link from "next/link";
import { Film } from "lucide-react";
import { getTranslations } from "next-intl/server";

import type { Locale } from "@/i18n/routing";
import { parseHelpMarkdown, type HelpBlock } from "@/lib/cad-champions/help/markdown";
import { ccPath } from "@/lib/cad-champions/routes";
import type { Inline } from "@/lib/legal/markdown";

// Renders help article markdown as React text nodes (no raw HTML). The site's
// legal renderer links with the site-wide next-intl Link, which would produce
// the wrong internal locale form for CC pages, so this renderer links with
// next/link + ccPath. Links such as /help/x are treated as CC paths.

const linkClass = "text-accent underline underline-offset-2 hover:text-cobalt-hover";

function Inlines({ nodes, locale }: { nodes: Inline[]; locale: Locale }) {
  return (
    <>
      {nodes.map((n, i) => {
        if (n.type === "text") return n.value;
        if (n.type === "bold") {
          return (
            <strong key={i} className="font-semibold text-heading">
              <Inlines nodes={n.children} locale={locale} />
            </strong>
          );
        }
        if (/^https?:\/\//i.test(n.href)) {
          return (
            <a key={i} href={n.href} target="_blank" rel="noopener noreferrer" className={linkClass}>
              <Inlines nodes={n.children} locale={locale} />
            </a>
          );
        }
        if (n.href.startsWith("/")) {
          const href = n.href.startsWith("/cad-champions") ? n.href : ccPath(locale, n.href);
          return (
            <Link key={i} href={href} className={linkClass}>
              <Inlines nodes={n.children} locale={locale} />
            </Link>
          );
        }
        return (
          <a key={i} href={n.href} className={linkClass}>
            <Inlines nodes={n.children} locale={locale} />
          </a>
        );
      })}
    </>
  );
}

function VideoSlot({ title, body }: { title: string; body: string }) {
  return (
    <div className="neu-inset flex items-center gap-4 p-5" role="note">
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-surface text-accent shadow-neu-sm">
        <Film aria-hidden="true" strokeWidth={1.75} className="h-6 w-6" />
      </span>
      <div>
        <p className="text-sm font-bold text-ink">{title}</p>
        <p className="text-sm text-body">{body}</p>
      </div>
    </div>
  );
}

function Block({ block, locale, video }: { block: HelpBlock; locale: Locale; video: { title: string; body: string } }) {
  switch (block.type) {
    case "heading":
      return block.level <= 2 ? (
        <h2 className="mt-8 text-xl font-bold text-heading">
          <Inlines nodes={block.children} locale={locale} />
        </h2>
      ) : (
        <h3 className="mt-6 text-lg font-bold text-heading">
          <Inlines nodes={block.children} locale={locale} />
        </h3>
      );
    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag
          className={`ms-6 space-y-1.5 text-base leading-relaxed text-body marker:text-accent ${block.ordered ? "list-decimal" : "list-disc"}`}
        >
          {block.items.map((item, j) => (
            <li key={j}>
              <Inlines nodes={item} locale={locale} />
            </li>
          ))}
        </Tag>
      );
    }
    case "table":
      return (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-start text-sm text-body">
            <thead>
              <tr>
                {block.head.map((c, j) => (
                  <th key={j} className="border-b border-borderstrong/60 px-3 py-2 text-start font-semibold text-heading">
                    <Inlines nodes={c} locale={locale} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((c, j) => (
                    <td key={j} className="border-b border-borderstrong/30 px-3 py-2 align-top">
                      <Inlines nodes={c} locale={locale} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "image":
      return (
        <figure className="neu-inset overflow-hidden p-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- admin-provided URLs; next/image would need allow-listed hosts */}
          <img src={block.src} alt={block.alt} loading="lazy" className="mx-auto h-auto max-w-full rounded-xl" />
          {block.alt ? <figcaption className="px-2 py-2 text-center text-sm text-mutedtext">{block.alt}</figcaption> : null}
        </figure>
      );
    case "quote":
      return (
        <blockquote className="rounded-2xl border border-[#c3d6f3] bg-[#e3edfb] p-4 text-base text-ink">
          <Inlines nodes={block.children} locale={locale} />
        </blockquote>
      );
    case "video":
      return <VideoSlot title={video.title} body={video.body} />;
    default:
      return (
        <p className="text-base leading-relaxed text-body">
          <Inlines nodes={block.children} locale={locale} />
        </p>
      );
  }
}

export async function ArticleBody({
  markdown,
  locale,
  hasVideoId,
}: {
  markdown: string;
  locale: Locale;
  /** Article has a video_id: a video slot is shown even if the text has no {{video}} marker. */
  hasVideoId: boolean;
}) {
  const t = await getTranslations({ locale, namespace: "CC.help" });
  const video = { title: t("videoSlotTitle"), body: t("videoSlotBody") };
  const blocks = parseHelpMarkdown(markdown);
  const hasMarker = blocks.some((b) => b.type === "video");
  return (
    <div className="space-y-4 break-words">
      {hasVideoId && !hasMarker ? <VideoSlot title={video.title} body={video.body} /> : null}
      {blocks.map((b, i) => (
        <Block key={i} block={b} locale={locale} video={video} />
      ))}
    </div>
  );
}
