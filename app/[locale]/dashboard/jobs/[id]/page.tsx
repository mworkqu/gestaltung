import { notFound, redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowLeft, Download, FileBox } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { getSessionContext } from "@/lib/auth/get-session";
import { createClient } from "@/lib/supabase/server";
import { CAD_BUCKET } from "@/lib/jobs/constants";
import type { Job, JobFile, JobEvent } from "@/lib/supabase/types";
import { JobActions } from "@/components/jobs/job-actions";
import { WorkshopJobPanel } from "@/components/jobs/workshop-job-panel";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const session = await getSessionContext();
  if (!session) redirect(`/${locale}/sign-in`);

  const t = await getTranslations("Jobs");
  const isRtl = locale === "ar";
  const mono = (extra = "") =>
    cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  const supabase = await createClient();

  // RLS: only the owner client, the assigned workshop, or super_admin loads it.
  const { data: job } = await supabase
    .from("jobs")
    .select("*")
    .eq("id", id)
    .single<Job>();
  if (!job) notFound();

  const { data: fileRows } = await supabase
    .from("job_files")
    .select("*")
    .eq("job_id", id)
    .order("uploaded_at", { ascending: true });
  const files = (fileRows ?? []) as JobFile[];

  const filesWithUrls = await Promise.all(
    files.map(async (f) => {
      const { data } = await supabase.storage
        .from(CAD_BUCKET)
        .createSignedUrl(f.storage_path, 60);
      return { ...f, url: data?.signedUrl ?? null };
    })
  );

  const { data: eventRows } = await supabase
    .from("job_events")
    .select("*")
    .eq("job_id", id)
    .order("created_at", { ascending: true });
  const events = (eventRows ?? []) as JobEvent[];

  const role = session.profile.role;
  const myTenant = session.profile.tenant_id;
  const isSuperAdmin = role === "super_admin";
  const isOwnerClient = role === "client" && job.client_tenant_id === myTenant;
  const isAssignedWorkshop =
    role === "workshop" && job.assigned_workshop_tenant_id === myTenant;

  // super_admin: client name, the workshop picker list, and assigned name.
  let clientName: string | null = null;
  let workshopTenants: { id: string; name: string }[] = [];
  let assignedName: string | null = null;
  if (isSuperAdmin) {
    const { data: tens } = await supabase.from("tenants").select("id, name, type");
    const all = tens ?? [];
    clientName = all.find((x) => x.id === job.client_tenant_id)?.name ?? null;
    workshopTenants = all.filter((x) => x.type === "workshop");
    assignedName =
      all.find((x) => x.id === job.assigned_workshop_tenant_id)?.name ?? null;
  } else if (isAssignedWorkshop) {
    // Workshop can't read other tenants directly — resolve the client via RPC.
    const { data: cn } = await supabase.rpc("accessible_client_tenants");
    clientName =
      (cn ?? []).find(
        (x: { id: string; name: string }) => x.id === job.client_tenant_id
      )?.name ?? null;
  }

  // Workshop's own inventory + this job's BOM rows (for the BOM / Start Job panel).
  let inventoryItems: { id: string; name: string; unit: string; quantity: number }[] = [];
  let bomRows: {
    id: string;
    inventory_item_id: string;
    quantity_needed: number;
    item: { name: string; unit: string; quantity: number } | null;
  }[] = [];
  if (isAssignedWorkshop) {
    const { data: inv } = await supabase
      .from("inventory_items")
      .select("id, name, unit, quantity")
      .order("name", { ascending: true });
    inventoryItems = inv ?? [];

    const { data: bom } = await supabase
      .from("job_bom")
      .select("id, inventory_item_id, quantity_needed, inventory_items(name, unit, quantity)")
      .eq("job_id", id)
      .order("created_at", { ascending: true });
    // PostgREST returns the to-one embed as an object at runtime, but the
    // untyped client infers an array — normalize either shape.
    bomRows = ((bom ?? []) as unknown[]).map((raw) => {
      const r = raw as {
        id: string;
        inventory_item_id: string;
        quantity_needed: number;
        inventory_items:
          | { name: string; unit: string; quantity: number }
          | { name: string; unit: string; quantity: number }[]
          | null;
      };
      const item = Array.isArray(r.inventory_items)
        ? r.inventory_items[0] ?? null
        : r.inventory_items;
      return {
        id: r.id,
        inventory_item_id: r.inventory_item_id,
        quantity_needed: r.quantity_needed,
        item,
      };
    });
  }

  const dateFmt = new Intl.DateTimeFormat(locale === "ar" ? "ar-QA" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  const isInternal = job.job_source === "internal";
  const rows: { label: string; value: string }[] = [
    { label: t("methodLabel"), value: t(`method_${job.method}`) },
    { label: t("statusLabel"), value: t(`status_${job.status}`) },
    ...(isInternal
      ? []
      : [{ label: t("quantityLabel"), value: String(job.quantity) }]),
    ...(isInternal
      ? []
      : [{ label: t("materialLabel"), value: job.material || "—" }]),
    ...(clientName && !isInternal
      ? [{ label: t("colClient"), value: clientName }]
      : []),
    ...(isSuperAdmin
      ? [{ label: t("assignedToLabel"), value: assignedName ?? t("unassigned") }]
      : []),
    { label: t("createdLabel"), value: dateFmt.format(new Date(job.created_at)) },
  ];

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        href="/dashboard/jobs"
        className="inline-flex items-center gap-2 text-sm text-mutedtext transition-colors hover:text-heading"
      >
        <ArrowLeft className={cn("h-4 w-4", isRtl && "rotate-180")} />
        {t("backToList")}
      </Link>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-extrabold text-heading">{job.title}</h1>
        <span className="rounded-full bg-cobalt/10 px-2.5 py-0.5 text-[11px] font-semibold text-cobalt">
          {t(`status_${job.status}`)}
        </span>
        <span
          className={cn(
            "rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
            isInternal
              ? "bg-amber-500/15 text-amber-600"
              : "bg-secondary text-mutedtext"
          )}
        >
          {t(`source_${job.job_source}`)}
        </span>
      </div>

      <div className="neu mt-6 divide-y divide-borderstrong/60 p-2">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-center justify-between gap-4 px-4 py-3"
          >
            <span className={mono("text-[10px] text-mutedtext")}>{row.label}</span>
            <span className="text-sm font-medium text-heading">{row.value}</span>
          </div>
        ))}
      </div>

      {job.notes && (
        <div className="neu mt-6 p-5">
          <p className={mono("text-[10px] text-mutedtext")}>{t("notesLabel")}</p>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-body">
            {job.notes}
          </p>
        </div>
      )}

      {/* Internal job parts list */}
      {isInternal && job.parts && job.parts.length > 0 && (
        <div className="neu mt-6 p-5">
          <p className={mono("text-[10px] text-azure")}>{t("partsTitle")}</p>
          <ul className="mt-3 space-y-2">
            {job.parts.map((p, i) => (
              <li
                key={i}
                className="flex items-center justify-between gap-4 rounded-xl bg-panel px-3 py-2 shadow-neu-sm"
              >
                <span className="text-sm font-medium text-heading">{p.name}</span>
                <span className="text-xs tabular-nums text-mutedtext">
                  {p.quantity} {p.unit}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Workshop: Bill of Materials + Start Job (stock deduction) */}
      {isAssignedWorkshop && (
        <WorkshopJobPanel
          jobId={job.id}
          status={job.status}
          inventoryItems={inventoryItems}
          bomRows={bomRows}
        />
      )}

      {/* Role-aware actions: assign/override (admin), advance (workshop), cancel (client) */}
      <JobActions
        role={role}
        jobId={job.id}
        status={job.status}
        assignedWorkshopTenantId={job.assigned_workshop_tenant_id}
        isOwnerClient={isOwnerClient}
        isAssignedWorkshop={isAssignedWorkshop}
        workshopTenants={workshopTenants}
      />

      {/* Files */}
      <div className="mt-6">
        <p className={mono("text-[10px] text-azure")}>{t("filesTitle")}</p>
        {filesWithUrls.length === 0 ? (
          <p className="mt-2 text-sm text-mutedtext">{t("noFiles")}</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {filesWithUrls.map((f) => (
              <li key={f.id} className="neu flex items-center gap-3 px-4 py-3">
                <FileBox className="h-5 w-5 shrink-0 text-cobalt" strokeWidth={1.5} />
                <span className="flex-1 truncate text-sm text-heading" dir="ltr">
                  {f.file_name}
                </span>
                <span className="shrink-0 text-[11px] uppercase text-faint">
                  {f.file_ext}
                </span>
                {f.url ? (
                  <a
                    href={f.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-cobalt px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-cobalt-hover"
                  >
                    <Download className="h-3.5 w-3.5" />
                    {t("download")}
                  </a>
                ) : (
                  <span className="shrink-0 text-[11px] text-destructive">
                    {t("error_unknown")}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Status timeline */}
      <div className="mt-6">
        <p className={mono("text-[10px] text-azure")}>{t("timelineTitle")}</p>
        <ol className="mt-3 space-y-3">
          {events.map((ev) => (
            <li key={ev.id} className="flex items-start gap-3">
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-cobalt" />
              <div>
                <p className="text-sm font-medium text-heading">
                  {t(`status_${ev.to_status}`)}
                </p>
                <p className="text-[11px] text-mutedtext">
                  {dateFmt.format(new Date(ev.created_at))}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
