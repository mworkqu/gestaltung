// A deliberately small, safe markdown reader for the legal pages
// (content/legal/*.md, split verbatim from the owner's LEGAL_PAGES_DRAFT.md).
// It supports exactly: paragraphs, **bold**, [text](url) links, # headings,
// "- " lists and pipe tables. It returns a plain data tree that React renders
// as text nodes, so nothing is ever injected as raw HTML.

export type Inline =
  | { type: "text"; value: string }
  | { type: "bold"; children: Inline[] }
  | { type: "link"; href: string; children: Inline[] };

export type Block =
  | { type: "paragraph"; children: Inline[] }
  | { type: "heading"; level: number; children: Inline[] }
  | { type: "list"; items: Inline[][] }
  | { type: "table"; head: Inline[][]; rows: Inline[][][] };

const SAFE_HREF = /^(https?:\/\/|mailto:|tel:|\/)/i;

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let rest = src;
  const push = (value: string) => {
    if (value) out.push({ type: "text", value });
  };
  // Earliest of **bold** or [text](url).
  const token = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/;
  while (rest) {
    const m = token.exec(rest);
    if (!m) {
      push(rest);
      break;
    }
    push(rest.slice(0, m.index));
    if (m[1] !== undefined) {
      out.push({ type: "bold", children: parseInline(m[1]) });
    } else if (SAFE_HREF.test(m[3])) {
      out.push({ type: "link", href: m[3], children: parseInline(m[2]) });
    } else {
      push(m[2]); // unsafe scheme: keep the words, drop the link
    }
    rest = rest.slice(m.index + m[0].length);
  }
  return out;
}

const splitRow = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());

const isSeparatorRow = (line: string) => /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/^\uFEFF/, "").split(/\r?\n/);
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: Inline[][] | null = null;

  const flushPara = () => {
    if (para.length) blocks.push({ type: "paragraph", children: parseInline(para.join(" ")) });
    para = [];
  };
  const flushList = () => {
    if (list) blocks.push({ type: "list", items: list });
    list = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") {
      flushPara();
      flushList();
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      flushPara();
      flushList();
      blocks.push({ type: "heading", level: heading[1].length, children: parseInline(heading[2].trim()) });
      continue;
    }
    const item = /^\s*[-*]\s+(.+)$/.exec(line);
    if (item) {
      flushPara();
      (list ??= []).push(parseInline(item[1].trim()));
      continue;
    }
    if (line.trim().startsWith("|") && i + 1 < lines.length && isSeparatorRow(lines[i + 1])) {
      flushPara();
      flushList();
      const head = splitRow(line).map(parseInline);
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
    para.push(line.trim());
  }
  flushPara();
  flushList();
  return blocks;
}

/** Plain text of an inline tree (used by tests to prove nothing was dropped). */
export function inlineText(nodes: Inline[]): string {
  return nodes.map((n) => (n.type === "text" ? n.value : inlineText(n.children))).join("");
}
