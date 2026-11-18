// Pure part of the policy loader (tested in prep.test.ts).

/** Drops the leading DRAFT marker (an HTML comment) and fills {{contact_email}}. */
export function prepPolicyMarkdown(raw: string, contactEmail: string): string {
  return raw
    .replace(/^﻿/, "")
    .replace(/^\s*<!--[\s\S]*?-->\s*/, "")
    .replace(/\{\{\s*contact_email\s*\}\}/g, contactEmail);
}
