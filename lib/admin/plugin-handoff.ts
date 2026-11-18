// Reads one plugin_handoffs row (migration 0112) for the admin lead page.
// The table's generated types may not exist yet and jsonb `build` is
// free-form, so every field is read defensively: a missing key is null, never
// a crash. Pure.

export type PluginHandoffInfo = {
  source: "claude" | "chatgpt" | "other";
  projectName: string | null;
  partsTotalQar: number | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  createdAt: string | null;
  claimedAt: string | null;
  projectId: string | null;
  requirementQuotes: string[];
  cadPrompt: string | null;
  openscad: string | null;
};

function rec(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}
function num(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}
function first<T>(...vals: (T | null)[]): T | null {
  return vals.find((v) => v !== null) ?? null;
}

export function readPluginHandoff(row: unknown): PluginHandoffInfo {
  const r = rec(row);
  const build = rec(r.build);
  const cad = rec(build.cad);
  const contact = rec(build.contact);
  const src = str(r.source) ?? str(build.source);
  const quotes = Array.isArray(build.requirement_quotes)
    ? build.requirement_quotes.map((q) => (typeof q === "string" ? q.trim() : "")).filter(Boolean)
    : [];
  return {
    source: src === "claude" || src === "chatgpt" ? src : "other",
    projectName: first(str(r.project_name), str(build.project_name), str(build.name)),
    partsTotalQar: first(num(r.parts_total_qar), num(build.parts_total_qar), num(build.parts_total)),
    contactName: first(str(r.contact_name), str(r.name), str(contact.name)),
    contactPhone: first(str(r.contact_phone), str(r.phone), str(contact.phone)),
    contactEmail: first(str(r.contact_email), str(r.email), str(contact.email)),
    createdAt: str(r.created_at),
    claimedAt: str(r.claimed_at),
    projectId: str(r.project_id),
    requirementQuotes: quotes,
    cadPrompt: str(cad.prompt),
    openscad: str(cad.openscad),
  };
}

/** A file-name-safe slug for the .scad download. */
export function scadFileName(projectName: string | null): string {
  const slug = (projectName ?? "")
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60);
  return `${slug || "project"}.scad`;
}
