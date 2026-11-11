// Help article markdown (pure). Extends the site's small safe reader
// (lib/legal/markdown.ts: paragraphs, **bold**, [links](url), headings, "- "
// lists, pipe tables) with: ordered lists ("1. "), standalone images
// (![alt](url)), block quotes ("> " callouts) and a video slot marker
// ({{video}}). Everything is returned as a data tree; no raw HTML is injected.

import { parseInline, type Inline } from "@/lib/legal/markdown";

export type HelpBlock =
  | { type: "paragraph"; children: Inline[] }
  | { type: "heading"; level: number; children: Inline[] }
  | { type: "list"; ordered: boolean; items: Inline[][] }
  | { type: "table"; head: Inline[][]; rows: Inline[][][] }
  | { type: "image"; alt: string; src: string }
  | { type: "quote"; children: Inline[] }
  | { type: "video" };

const SAFE_IMAGE = /^(https:\/\/|\/)/i;

const splitRow = (line: string): string[] =>
  line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

const isSeparatorRow = (line: string) => /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);

export function parseHelpMarkdown(src: string): HelpBlock[] {
  const lines = src.replace(/^﻿/, "").split(/\r?\n/);
  const blocks: HelpBlock[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: Inline[][] } | null = null;
  let quote: string[] = [];

  const flushPara = () => {
    if (para.length) blocks.push({ type: "paragraph", children: parseInline(para.join(" ")) });
    para = [];
  };
  const flushList = () => {
    if (list) blocks.push({ type: "list", ordered: list.ordered, items: list.items });
    list = null;
  };
  const flushQuote = () => {
    if (quote.length) blocks.push({ type: "quote", children: parseInline(quote.join(" ")) });
    quote = [];
  };
  const flushAll = () => {
    flushPara();
    flushList();
    flushQuote();
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === "") {
      flushAll();
      continue;
    }
    if (/^\{\{\s*video\s*\}\}$/i.test(trimmed)) {
      flushAll();
      blocks.push({ type: "video" });
      continue;
    }
    const img = /^!\[([^\]]*)\]\(([^)\s]+)\)$/.exec(trimmed);
    if (img) {
      flushAll();
      if (SAFE_IMAGE.test(img[2])) blocks.push({ type: "image", alt: img[1], src: img[2] });
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (heading) {
      flushAll();
      blocks.push({ type: "heading", level: heading[1].length, children: parseInline(heading[2].trim()) });
      continue;
    }
    const q = /^>\s?(.*)$/.exec(trimmed);
    if (q) {
      flushPara();
      flushList();
      quote.push(q[1]);
      continue;
    }
    const ul = /^[-*]\s+(.+)$/.exec(trimmed);
    const ol = /^\d+[.)]\s+(.+)$/.exec(trimmed);
    if (ul || ol) {
      flushPara();
      flushQuote();
      const ordered = Boolean(ol);
      if (list && list.ordered !== ordered) flushList();
      (list ??= { ordered, items: [] }).items.push(parseInline((ul ?? ol)![1].trim()));
      continue;
    }
    if (trimmed.startsWith("|") && i + 1 < lines.length && isSeparatorRow(lines[i + 1])) {
      flushAll();
      const head = splitRow(trimmed).map(parseInline);
      const rows: Inline[][][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        rows.push(splitRow(lines[i]).map(parseInline));
        i++;
      }
      i--;
      blocks.push({ type: "table", head, rows });
      continue;
    }
    flushList();
    flushQuote();
    para.push(trimmed);
  }
  flushAll();
  return blocks;
}

/** Plain text of markdown (for search snippets): drops syntax, keeps words. */
export function markdownToPlain(src: string): string {
  return src
    .replace(/\{\{\s*video\s*\}\}/gi, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/^\s*(#{1,6}|>|[-*]|\d+[.)])\s+/gm, "")
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
