"use client";

// The code, one element per line (P5-17). Lines in the pin block and every line
// that uses a pin constant are interactive: hover (desktop), tap (touch) or
// Enter (keyboard) opens a small floating preview of that wire — a drawn
// "Wiring snippet", the wire in words and "Show in wiring". Esc closes it.
// `highlight` tints the lines of a wire the client came from ("Show in code").

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { Cable, X } from "lucide-react";

import { WIRE_HEX, type Connection } from "@/lib/studio/connections";
import type { LineLink } from "@/lib/studio/code-link";
import type { GetPart, Locale } from "@/lib/studio/netlist";
import { wireWords, WireSwatch } from "../wiring/SelectedWire";
import { linkCls } from "../../ui";

const WireSnippet = dynamic(() => import("./WireSnippet"), {
  ssr: false,
  loading: () => <div className="h-[116px] w-full animate-pulse rounded-xl bg-[#eef2f7]" aria-hidden />,
});

type Open = { line: number; id: string; top?: number; bottom?: number; left: number; width: number; via: "hover" | "click" };

const PREVIEW_W = 320;

/** The browser fakes a pointer move when the page scrolls under a resting cursor; only real moves open a preview. */
const still = (e: React.PointerEvent) => e.movementX === 0 && e.movementY === 0;

export function CodeLines({
  code,
  links,
  byId,
  getPart,
  locale,
  highlight,
  onShowInWiring,
  label,
}: {
  code: string;
  links: Map<number, LineLink>;
  byId: Map<string, Connection>;
  getPart: GetPart;
  locale: Locale;
  /** 0-based lines to tint (a wire picked in the Wiring step). */
  highlight: Set<number>;
  onShowInWiring?: (id: string) => void;
  label: string;
}) {
  const t = useTranslations("Studio.views");
  const lines = useMemo(() => code.split("\n"), [code]);
  const [open, setOpen] = useState<Open | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const lineRefs = useRef(new Map<number, HTMLElement>());

  const cancelClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  const close = useCallback((refocus = false) => {
    setOpen((o) => {
      if (o && refocus) lineRefs.current.get(o.line)?.focus();
      return null;
    });
  }, []);

  const place = useCallback((line: number, id: string, via: Open["via"]) => {
    const el = lineRefs.current.get(line);
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const width = Math.min(PREVIEW_W, vw - 24);
    const left = Math.max(12, Math.min(r.left + 24, vw - width - 12));
    const below = r.bottom + 6;
    // Below the line when it fits (~270 px), else above it (anchored by its bottom edge).
    const above = below + 270 > window.innerHeight && r.top > 270;
    setOpen(above ? { line, id, bottom: window.innerHeight - r.top + 6, left, width, via } : { line, id, top: below, left, width, via });
  }, []);

  // Keep the preview next to its line when the page or the code scrolls; close when it scrolls away.
  useEffect(() => {
    if (!open) return;
    const onMove = () => {
      const el = lineRefs.current.get(open.line);
      const r = el?.getBoundingClientRect();
      if (!r || r.bottom < 0 || r.top > window.innerHeight) close();
      else place(open.line, open.id, open.via);
    };
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (previewRef.current?.contains(target)) return;
      if ((target as HTMLElement).closest?.("[data-pin-const]")) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(true);
    };
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close, place]);

  useEffect(() => () => cancelClose(), []);

  // A new code string (pins updated) invalidates line numbers.
  useLayoutEffect(() => {
    setOpen(null);
  }, [code]);

  const c = open ? byId.get(open.id) : undefined;
  const words = c ? wireWords(c, getPart, locale) : null;
  const n = lines.length;
  const gutter = String(n).length;

  return (
    <>
      <pre
        dir="ltr"
        data-testid="studio-code"
        aria-label={label}
        tabIndex={0}
        className="max-h-[420px] overflow-auto rounded-2xl bg-[#1c2434] py-4 text-start font-mono text-xs leading-relaxed text-[#e7ecf3]"
      >
        <code className="block min-w-max">
          {lines.map((text, i) => {
            const link = links.get(i);
            const hot = highlight.has(i);
            const active = open?.line === i;
            const base = "flex border-s-[3px] pe-4 ps-[13px] transition-colors";
            const gut = (
              <span aria-hidden className="me-4 inline-block shrink-0 select-none text-end text-[#64748b]" style={{ width: `${gutter}ch` }}>
                {i + 1}
              </span>
            );
            if (!link) {
              return (
                <span key={i} data-testid="studio-code-line" data-line={i + 1} className={`${base} border-transparent ${hot ? "bg-[#6366f1]/30" : ""}`}>
                  {gut}
                  <span className="whitespace-pre">{text || " "}</span>
                </span>
              );
            }
            const conn = byId.get(link.connectionId);
            const ww = conn ? wireWords(conn, getPart, locale) : null;
            return (
              <span
                key={i}
                ref={(el) => {
                  if (el) lineRefs.current.set(i, el);
                  else lineRefs.current.delete(i);
                }}
                role="button"
                tabIndex={0}
                aria-haspopup="dialog"
                aria-expanded={active}
                aria-label={ww ? t("code.lineLabel", { n: String(i + 1), name: link.name, from: ww.from, to: ww.to }) : link.name}
                data-testid="studio-code-line"
                data-line={i + 1}
                data-pin-const={link.name}
                data-connection={link.connectionId}
                data-highlight={hot ? "true" : undefined}
                style={{ borderInlineStartColor: conn ? WIRE_HEX[conn.wireColour] : "transparent" }}
                className={`${base} cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#a5b4fc] ${
                  hot ? "bg-[#6366f1]/35" : active ? "bg-white/10" : "hover:bg-white/5"
                }`}
                onPointerEnter={(e) => {
                  if (e.pointerType === "touch" || still(e)) return;
                  cancelClose();
                  if (open?.via !== "click" || open.line !== i) place(i, link.connectionId, "hover");
                }}
                onPointerMove={(e) => {
                  // The pointer can already sit on a line when the code appears (no enter event).
                  if (e.pointerType === "touch" || still(e) || open?.line === i) return;
                  cancelClose();
                  place(i, link.connectionId, "hover");
                }}
                onPointerLeave={(e) => {
                  if (e.pointerType === "touch" || open?.via === "click") return;
                  cancelClose();
                  closeTimer.current = setTimeout(() => close(), 220);
                }}
                onClick={() => {
                  cancelClose();
                  if (open?.line === i && open.via === "click") close();
                  else place(i, link.connectionId, "click");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    place(i, link.connectionId, "click");
                    requestAnimationFrame(() => previewRef.current?.querySelector<HTMLElement>("button")?.focus());
                  }
                }}
              >
                {gut}
                <span className="whitespace-pre">{text || " "}</span>
              </span>
            );
          })}
        </code>
      </pre>

      {open && c && words && (
        <div
          ref={previewRef}
          role="dialog"
          aria-label={t("code.previewTitle")}
          data-testid="studio-wire-preview"
          data-connection={c.id}
          dir={locale === "ar" ? "rtl" : "ltr"}
          className="fixed z-50 space-y-2 rounded-2xl border border-[#d6dde8] bg-surface p-3 shadow-neu"
          style={{ top: open.top, bottom: open.bottom, left: open.left, width: open.width }}
          onMouseEnter={cancelClose}
          onMouseLeave={() => {
            if (open.via === "click") return;
            closeTimer.current = setTimeout(() => close(), 220);
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <p className="kicker text-mutedtext">{t("code.previewTitle")}</p>
            <button type="button" className="grid h-9 w-9 place-items-center rounded-full text-mutedtext hover:text-heading" onClick={() => close(true)} aria-label={t("code.closePreview")}>
              <X className="h-4 w-4" strokeWidth={1.75} aria-hidden />
            </button>
          </div>
          <WireSnippet c={c} getPart={getPart} locale={locale} />
          <p className="flex items-start gap-2 text-sm font-semibold text-heading" dir="auto">
            <WireSwatch c={c} size={14} />
            <span className="min-w-0">
              {t("wireLabel", { from: words.from, to: words.to, colour: words.colour })}
              {words.via && <span className="block text-xs font-medium text-mutedtext">{t("code.via", { part: words.via })}</span>}
            </span>
          </p>
          {onShowInWiring && (
            <button type="button" className={linkCls} onClick={() => onShowInWiring(c.id)} data-testid="studio-show-in-wiring">
              <Cable className="h-4 w-4" strokeWidth={1.75} aria-hidden />
              {t("showInWiring")}
            </button>
          )}
        </div>
      )}
    </>
  );
}
