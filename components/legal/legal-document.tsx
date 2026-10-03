import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Metadata } from "next";

import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { LEGAL_KEYS, loadLegalContent, type LegalSlug } from "@/lib/legal/content";
import type { Block, Inline } from "@/lib/legal/markdown";

// Shared layout for the four legal pages. The body is the owner's text, parsed
// from content/legal/*.md into a data tree and rendered as React text nodes —
// no raw HTML is ever injected.

function renderInline(nodes: Inline[]): React.ReactNode {
  return nodes.map((n, i) => {
    if (n.type === "text") return n.value;
    if (n.type === "bold") return <strong key={i} className="font-semibold text-heading">{renderInline(n.children)}</strong>;
    const external = /^https?:\/\//i.test(n.href);
    return n.href.startsWith("/") ? (
      <Link key={i} href={n.href} className="text-cobalt underline underline-offset-2">
        {renderInline(n.children)}
      </Link>
    ) : (
      <a
        key={i}
        href={n.href}
        className="text-cobalt underline underline-offset-2"
        {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      >
        {renderInline(n.children)}
      </a>
    );
  });
}

function renderBlock(b: Block, i: number): React.ReactNode {
  switch (b.type) {
    case "heading": {
      const cls = "mt-8 text-lg font-bold text-heading";
      return b.level <= 2 ? (
        <h2 key={i} className={cls}>{renderInline(b.children)}</h2>
      ) : (
        <h3 key={i} className={cls}>{renderInline(b.children)}</h3>
      );
    }
    case "list":
      return (
        <ul key={i} className="ms-6 list-disc space-y-1.5 text-base leading-relaxed text-body marker:text-cobalt">
          {b.items.map((item, j) => (
            <li key={j}>{renderInline(item)}</li>
          ))}
        </ul>
      );
    case "table":
      return (
        <div key={i} className="overflow-x-auto">
          <table className="w-full border-collapse text-start text-sm text-body">
            <thead>
              <tr>
                {b.head.map((c, j) => (
                  <th key={j} className="border-b border-borderstrong/60 px-3 py-2 text-start font-semibold text-heading">
                    {renderInline(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((c, j) => (
                    <td key={j} className="border-b border-borderstrong/30 px-3 py-2 align-top">
                      {renderInline(c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    default:
      return (
        <p key={i} className="text-base leading-relaxed text-body">
          {renderInline(b.children)}
        </p>
      );
  }
}

export function legalMetadata(slug: LegalSlug) {
  return async ({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> => {
    const { locale } = await params;
    const t = await getTranslations({ locale, namespace: "Legal" });
    return { title: t("metaTitle", { title: t(`${LEGAL_KEYS[slug]}Title`) }) };
  };
}

export function legalPage(slug: LegalSlug) {
  return async function LegalPage({ params }: { params: Promise<{ locale: string }> }) {
    const { locale } = await params;
    setRequestLocale(locale);

    const t = await getTranslations("Legal");
    const isRtl = locale === "ar";
    const blocks = loadLegalContent(slug, locale);

    return (
      <div className="container space-y-6 py-6">
        <section className="animate-fade-up flex flex-col gap-5 px-1">
          <span className="inline-flex w-fit items-center gap-2 rounded-full bg-panel px-3 py-1.5 shadow-neu-sm">
            <span className="h-2 w-2 rounded-full bg-cobalt" />
            <span
              className={cn(
                "text-[10px] text-mutedtext",
                isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]"
              )}
            >
              {t("kicker")}
            </span>
          </span>
          <h1 className="text-[2rem] font-extrabold leading-[1.1] tracking-tight text-heading sm:text-4xl lg:text-[2.75rem]">
            {t(`${LEGAL_KEYS[slug]}Title`)}
          </h1>
        </section>

        <article className="neu animate-fade-up delay-1 mx-auto w-full max-w-3xl space-y-4 p-6 sm:p-10">
          {blocks.map(renderBlock)}
        </article>
      </div>
    );
  };
}
