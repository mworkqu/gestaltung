// Reads the message each lead endpoint writes (/api/design-quote,
// /api/project-cad, /api/store-lead) into fields the admin card can lay out as a
// tidy summary: method, file name + size, project, notes. The raw download URL,
// project UUID and export link never reach the visible text; the card only
// keeps them for button hrefs. Pure; reads both today's and older messages.

import { QUOTE_BUCKET, CAD_BUCKET } from "@/lib/design/constants";
import { leadKind } from "@/lib/admin/lead-kind";

export type ParsedLead = {
  method: string | null;
  fileName: string | null;
  /** "1.2 MB" as the message said it; null when absent or the old "0.00 MB". */
  fileSize: string | null;
  /** The upload never reached storage (the customer must send the file another way). */
  uploadFailed: boolean;
  /** The 7-day signed link from the original email (expires; a fresh one is minted from `storage`). */
  downloadUrl: string | null;
  /** Where the file lives, when the message says so. */
  storage: { bucket: string; path: string } | null;
  projectId: string | null;
  projectName: string | null;
  /** The customer's notes. */
  notes: string | null;
  /** Everything else, with URLs and ids removed. */
  body: string;
};

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const URL_RE = /https?:\/\/[^\s)]+/gi;

const SIZE_RE = /\((\d+(?:\.\d+)?)\s*(B|KB|MB|GB)\)/i;

/** Strip URLs and ids from text meant to be read. */
export function stripLinksAndIds(text: string): string {
  return text
    .replace(URL_RE, "")
    .replace(new RegExp(UUID_RE.source, "gi"), "")
    .replace(/\(\s*\)/g, "")
    .replace(/\(\s*export:\s*\)/gi, "")
    .replace(/[ \t]+—[ \t]*$/gm, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+$/gm, "")
    .trim();
}

function storageFrom(raw: string): { bucket: string; path: string } | null {
  const v = raw.trim();
  if (!v) return null;
  for (const bucket of [QUOTE_BUCKET, CAD_BUCKET]) {
    if (v.startsWith(`${bucket}/`)) return { bucket, path: v.slice(bucket.length + 1) };
  }
  return null;
}

export function parseLeadMessage(message: string | null | undefined): ParsedLead {
  const out: ParsedLead = {
    method: null,
    fileName: null,
    fileSize: null,
    uploadFailed: false,
    downloadUrl: null,
    storage: null,
    projectId: null,
    projectName: null,
    notes: null,
    body: "",
  };
  const raw = (message ?? "").replace(/\r\n/g, "\n");
  const kind = leadKind(raw);

  // Free text a person wrote (contact form, callback): show it as typed.
  if (kind === "contact" || kind === "callback") {
    out.body = raw.trim();
    return out;
  }

  const lines = raw.split("\n");
  const rest: string[] = [];
  let inNotes = false;
  const notes: string[] = [];

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    const t = line.trim();
    if (inNotes) {
      notes.push(line);
      continue;
    }
    let m: RegExpMatchArray | null;

    if ((m = t.match(/^Notes?:\s*(.*)$/i))) {
      inNotes = true;
      if (m[1]) notes.push(m[1]);
      continue;
    }
    if ((m = t.match(/^Method:\s*(.+)$/i))) {
      out.method = m[1].trim();
      continue;
    }
    if ((m = t.match(/^File:\s*(.+)$/i))) {
      let v = m[1];
      if (/upload failed/i.test(v)) {
        out.uploadFailed = true;
        v = v.replace(/\s*—.*$/, "");
      }
      const size = v.match(SIZE_RE);
      if (size) {
        const n = Number(size[1]);
        // The old emails printed "0.00 MB" for every small file: not a size.
        if (n > 0) out.fileSize = `${size[1]} ${size[2].toUpperCase()}`;
        v = v.replace(SIZE_RE, "");
      }
      const name = v.trim();
      out.fileName = /^none provided$/i.test(name) ? null : name || null;
      continue;
    }
    if ((m = t.match(/^Download(?:\s*\([^)]*\))?:\s*(\S+)/i))) {
      out.downloadUrl = m[1];
      continue;
    }
    if ((m = t.match(/^(?:Storage|File path):\s*(.+)$/i))) {
      out.storage = storageFrom(m[1]);
      continue;
    }
    if ((m = t.match(/^Stored at:\s*(.+)$/i))) {
      continue; // legacy raw path, bucket unknown; nothing useful to show
    }
    if ((m = t.match(/^Project ID:\s*(\S+)/i))) {
      out.projectId = m[1].match(UUID_RE)?.[0] ?? out.projectId;
      continue;
    }
    if ((m = t.match(/^Project:\s*(.+)$/i))) {
      const v = m[1];
      const id = v.match(UUID_RE)?.[0] ?? null;
      if (id) out.projectId = id;
      // "Project: <uuid> (export: url)" has no name; "Project: Box — url" does.
      const name = stripLinksAndIds(v.replace(/\(export:[^)]*\)/i, "")).replace(/\s*—\s*$/, "").trim();
      if (name && !/^\(?name not readable\)?$/i.test(name)) out.projectName = name;
      continue;
    }
    if (/^(Email|Phone \/ WhatsApp|Customer):/i.test(t)) continue; // shown in the card header
    if ((m = t.match(/^Drawing request for project\s+"(.+)"\s+\(/i))) {
      out.projectName = m[1].trim();
      out.projectId = t.match(UUID_RE)?.[0] ?? out.projectId;
      continue;
    }
    // The first sentence ("Custom manufacturing quote request.") is the badge.
    if (idx === 0 && /^(custom manufacturing quote request|cad file attached to a project)/i.test(t)) continue;
    rest.push(line);
  }

  // The customer's own words are kept as typed.
  out.notes = notes.join("\n").trim() || null;
  out.body = stripLinksAndIds(rest.join("\n")).replace(/\n{3,}/g, "\n\n");
  return out;
}
