import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Download, FolderOpen, Inbox, Mail, MessageCircle } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { createServiceClient } from "@/lib/supabase/service";
import { LEAD_KINDS, leadKind, leadProjectId, type LeadKind } from "@/lib/admin/lead-kind";
import { CAD_BUCKET } from "@/lib/design/constants";

import type { Inquiry, InquiryStatus } from "@/lib/supabase/types";
import { setLeadStatus } from "./actions";
import { getSessionContext } from "@/lib/auth/get-session";
import { createClient } from "@/lib/supabase/server";
import { formatPhoneDisplay, toWhatsAppDigits } from "@/lib/phone";
import { parseLeadMessage } from "@/lib/admin/lead-parse";
import { cn } from "@/lib/utils";

// Every enquiry the site captures — homepage callbacks and CAD quote requests
// both land in `inquiries` via /api/store-lead and /api/design-quote. Read-only
// triage view: the owner replies over WhatsApp, which is why the number gets a
// direct wa.me link rather than plain text to copy.
export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, string> = {
  new: "border-azure/40 bg-azure/10 text-azure",
  contacted: "border-borderstrong bg-panel text-body",
  closed: "border-borderstrong/60 bg-transparent text-faint",
};

// Offer the two statuses a lead isn't already in, so triage is one click either
// way: advance it, or reopen something closed too early.
const STATUS_ACTIONS: Record<InquiryStatus, InquiryStatus[]> = {
  new: ["contacted", "closed"],
  contacted: ["closed", "new"],
  closed: ["new", "contacted"],
};

const ACTION_LABEL: Record<InquiryStatus, "markNew" | "markContacted" | "markClosed"> = {
  new: "markNew",
  contacted: "markContacted",
  closed: "markClosed",
};

export default async function LeadsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ status?: string; kind?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  // Filters (audit Phase 6): open (new + contacted) by default; by kind.
  const statusFilter = ["new", "contacted", "closed", "all"].includes(sp.status ?? "") ? sp.status! : "open";
  const kindFilter = (LEAD_KINDS as readonly string[]).includes(sp.kind ?? "") ? (sp.kind as LeadKind) : null;
  setRequestLocale(locale);

  // RLS already restricts these rows to super_admin, but redirect rather than
  // render an empty table at a signed-in workshop or client.
  const session = await getSessionContext();
  if (!session) redirect(`/${locale}/sign-in`);
  if (session.profile.role !== "super_admin") redirect(`/${locale}/dashboard`);

  const t = await getTranslations("Leads");
  const isRtl = locale === "ar";
  const mono = (extra = "") =>
    cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  const supabase = await createClient();
  const { data } = await supabase
    .from("inquiries")
    .select("*")
    .order("created_at", { ascending: false });
  const all = (data ?? []) as Inquiry[];
  const leads = all.filter(
    (l) =>
      (statusFilter === "all" || (statusFilter === "open" ? l.status !== "closed" : l.status === statusFilter)) &&
      (!kindFilter || leadKind(l.message) === kindFilter)
  );

  // The CAD files on each lead's project, as fresh 1-hour download links
  // (the links inside old emails expire after 7 days).
  const projectIds = [...new Set(leads.map((l) => leadProjectId(l.message)).filter((x): x is string => !!x))];
  const filesByProject = new Map<string, { name: string; url: string }[]>();
  const svc = projectIds.length ? createServiceClient() : null;
  if (svc) {
    const { data: files } = await svc
      .from("project_files")
      .select("project_id, file_name, storage_path")
      .in("project_id", projectIds);
    for (const f of files ?? []) {
      const { data: signed } = await svc.storage.from(CAD_BUCKET).createSignedUrl(f.storage_path as string, 3600);
      if (!signed?.signedUrl) continue;
      const list = filesByProject.get(f.project_id as string) ?? [];
      list.push({ name: f.file_name as string, url: signed.signedUrl });
      filesByProject.set(f.project_id as string, list);
    }
  }
  // Lead files that live in storage: a fresh 1-hour link per lead (the link in
  // the email expires after 7 days). Falls back to the emailed link.
  const parsedById = new Map(leads.map((l) => [l.id, parseLeadMessage(l.message)] as const));
  const downloadById = new Map<string, string>();
  const svc2 = createServiceClient();
  for (const l of leads) {
    const p = parsedById.get(l.id)!;
    if (svc2 && p.storage) {
      const { data: signed } = await svc2.storage.from(p.storage.bucket).createSignedUrl(p.storage.path, 3600);
      if (signed?.signedUrl) downloadById.set(l.id, signed.signedUrl);
    }
    if (!downloadById.has(l.id) && p.downloadUrl) downloadById.set(l.id, p.downloadUrl);
  }
  // Print requests (Design Studio) carry several STLs: a fresh 1-hour link for each.
  const leadFilesById = new Map<string, { name: string; url: string }[]>();
  for (const l of leads) {
    const p = parsedById.get(l.id)!;
    if (!svc2 || !p.files.length) continue;
    const list: { name: string; url: string }[] = [];
    for (const f of p.files) {
      const { data: signed } = await svc2.storage.from(f.bucket).createSignedUrl(f.path, 3600);
      if (signed?.signedUrl) list.push({ name: f.name, url: signed.signedUrl });
    }
    if (list.length) leadFilesById.set(l.id, list);
  }
  const filterHref = (patch: { status?: string; kind?: string | null }) => {
    const q: Record<string, string> = {};
    const s = patch.status ?? statusFilter;
    const k = patch.kind === undefined ? kindFilter : patch.kind;
    if (s !== "open") q.status = s;
    if (k) q.kind = k;
    return { pathname: "/dashboard/leads", query: q };
  };
  const chip = (on: boolean) =>
    cn(
      "rounded-full px-3 py-1 text-xs font-medium transition-colors",
      on ? "bg-panel text-heading shadow-neu-sm" : "text-mutedtext hover:text-heading"
    );

  const dateFmt = new Intl.DateTimeFormat(isRtl ? "ar-QA-u-nu-latn" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <div>
      <div>
        <p className={mono("text-[10px] text-azure")}>{t("kicker")}</p>
        <h1 className="mt-2 text-2xl font-extrabold text-heading">{t("title")}</h1>
        <p className="mt-1 text-sm text-mutedtext">
          {t("count", { count: leads.length })}
        </p>
      </div>

      <div className="mt-6 space-y-2">
        <div className="flex flex-wrap gap-1">
          {(["open", "new", "contacted", "closed", "all"] as const).map((s) => (
            <Link key={s} href={filterHref({ status: s })} className={chip(statusFilter === s)}>
              {t(`filter_${s}`)}
            </Link>
          ))}
        </div>
        <div className="flex flex-wrap gap-1">
          <Link href={filterHref({ kind: null })} className={chip(!kindFilter)}>
            {t("kind_all")}
          </Link>
          {LEAD_KINDS.map((k) => (
            <Link key={k} href={filterHref({ kind: k })} className={chip(kindFilter === k)}>
              {t(`kind_${k}`)}
            </Link>
          ))}
        </div>
      </div>

      {leads.length === 0 ? (
        <div className="neu mt-8 flex flex-col items-center gap-3 p-12 text-center">
          <Inbox className="h-8 w-8 text-faint" aria-hidden />
          <p className="text-base font-semibold text-heading">{t("emptyTitle")}</p>
          <p className="max-w-sm text-sm text-mutedtext">{t("emptyBody")}</p>
        </div>
      ) : (
        <ul className="mt-8 space-y-4">
          {leads.map((lead) => {
            // null when the stored number can't form a valid wa.me link.
            const waDigits = toWhatsAppDigits(lead.phone);
            const kind = leadKind(lead.message);
            const projectId = leadProjectId(lead.message);
            const parsed = parsedById.get(lead.id)!;
            const leadDownload = downloadById.get(lead.id) ?? null;
            const projectFiles = projectId ? filesByProject.get(projectId) ?? [] : [];
            // The lead's own file first; project files only when it has none of its own.
            const leadFiles = leadFilesById.get(lead.id) ?? [];
            const files = [...leadFiles, ...(leadDownload || leadFiles.length ? [] : projectFiles)];
            const rows: { label: string; value: string; ltr?: boolean }[] = [
              ...(parsed.method ? [{ label: t("labelMethod"), value: parsed.method }] : []),
              ...(parsed.fileName
                ? [
                    {
                      label: t("labelFile"),
                      value: [parsed.fileName, parsed.fileSize && `(${parsed.fileSize})`, parsed.uploadFailed && `— ${t("uploadFailed")}`]
                        .filter(Boolean)
                        .join(" "),
                      ltr: !parsed.uploadFailed,
                    },
                  ]
                : []),
              ...(parsed.projectName ? [{ label: t("labelProject"), value: parsed.projectName }] : []),
            ];

            return (
              <li key={lead.id} className="neu p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-base font-semibold text-heading">
                      {lead.name}
                      <span className="ms-2 rounded-full bg-panel px-2 py-0.5 align-middle text-[10px] font-semibold text-cobalt shadow-neu-sm">
                        {t(`kind_${kind}`)}
                      </span>
                    </p>
                    <p className={mono("mt-1 text-[10px] text-faint")}>
                      {t("colDate")} · {dateFmt.format(new Date(lead.created_at))}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 rounded-full border px-3 py-1 text-[11px] font-medium",
                      STATUS_TONE[lead.status] ?? STATUS_TONE.contacted
                    )}
                  >
                    {t(`status_${lead.status}`)}
                  </span>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {waDigits ? (
                    <a
                      href={`https://wa.me/${waDigits}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 rounded-full border border-azure/40 bg-azure/10 px-4 py-2 text-sm font-medium text-azure transition hover:bg-azure/20"
                    >
                      <MessageCircle className="h-4 w-4" aria-hidden />
                      <span dir="ltr">{formatPhoneDisplay(lead.phone)}</span>
                    </a>
                  ) : (
                    <span
                      className="inline-flex items-center gap-2 rounded-full border border-borderstrong/60 px-4 py-2 text-sm text-faint"
                      title={t("whatsappUnavailable")}
                    >
                      <MessageCircle className="h-4 w-4" aria-hidden />
                      <span dir="ltr">{formatPhoneDisplay(lead.phone)}</span>
                    </span>
                  )}

                  {lead.email ? (
                    <a
                      href={`mailto:${lead.email}`}
                      className="inline-flex items-center gap-2 rounded-full border border-borderstrong px-4 py-2 text-sm text-body transition hover:border-azure/40 hover:text-azure"
                    >
                      <Mail className="h-4 w-4" aria-hidden />
                      <span dir="ltr">{lead.email}</span>
                    </a>
                  ) : (
                    <span className="text-sm text-faint">{t("noEmail")}</span>
                  )}

                  <span className={mono("text-[10px] text-faint")}>
                    {lead.locale}
                  </span>
                </div>

                <div className="mt-4 border-t border-borderstrong/60 pt-4">
                  {rows.length > 0 && (
                    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 rounded-xl bg-panel p-3 text-sm shadow-neu-inset">
                      {rows.map((row) => (
                        <div key={row.label} className="contents">
                          <dt className="text-xs text-mutedtext">{row.label}</dt>
                          <dd className="min-w-0 break-words font-semibold text-heading" dir={row.ltr ? "ltr" : undefined}>
                            {row.value}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  {(parsed.body || parsed.notes) && (
                    <>
                      <p className={mono("mt-3 text-[10px] text-faint")}>{parsed.notes && !parsed.body ? t("labelNotes") : t("colMessage")}</p>
                      <p className="mt-2 whitespace-pre-line break-words text-sm text-body">
                        {[parsed.body, parsed.notes && parsed.body ? `${t("labelNotes")}: ${parsed.notes}` : parsed.notes]
                          .filter(Boolean)
                          .join("\n\n")}
                      </p>
                    </>
                  )}
                  {(leadDownload || files.length > 0 || projectId) && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {leadDownload && (
                        <a
                          href={leadDownload}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-full bg-cobalt px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
                        >
                          <Download className="h-3.5 w-3.5" />
                          {t("downloadFile")}
                        </a>
                      )}
                      {files.map((f) => (
                        <a
                          key={f.url}
                          href={f.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-full bg-panel px-3 py-1.5 text-xs font-semibold text-heading shadow-neu-sm hover:text-cobalt"
                        >
                          <Download className="h-3.5 w-3.5" />
                          <span dir="ltr">{f.name}</span>
                        </a>
                      ))}
                      {projectId && (
                        <Link
                          href={{ pathname: "/dashboard/projects", query: { q: projectId } }}
                          className="inline-flex items-center gap-1.5 rounded-full bg-panel px-3 py-1.5 text-xs font-semibold text-heading shadow-neu-sm hover:text-cobalt"
                        >
                          <FolderOpen className="h-3.5 w-3.5" />
                          {t("openProject")}
                        </Link>
                      )}
                    </div>
                  )}
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-borderstrong/60 pt-4">
                  {STATUS_ACTIONS[lead.status].map((next) => (
                    <form key={next} action={setLeadStatus}>
                      <input type="hidden" name="id" value={lead.id} />
                      <input type="hidden" name="status" value={next} />
                      <input type="hidden" name="locale" value={locale} />
                      <button
                        type="submit"
                        className="rounded-full border border-borderstrong px-4 py-1.5 text-xs font-medium text-body transition hover:border-azure/40 hover:text-azure"
                      >
                        {t(ACTION_LABEL[next])}
                      </button>
                    </form>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
