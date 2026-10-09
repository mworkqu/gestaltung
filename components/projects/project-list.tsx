"use client";

import { useCallback, useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Archive, ArchiveRestore, Loader2, Plus } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import { getCurrentUser } from "@/lib/supabase/guest";
import { deriveProjectStatus, type ProjectStatusKind } from "@/lib/projects/item-status";
import { Button } from "@/components/ui/button";
import { Tag } from "@/components/ui/tag";
import type { Project } from "@/lib/supabase/types";
import { PROJECT_LIMIT } from "@/lib/credits/constants";
import { creditsChanged, useCreditSummary } from "@/lib/credits/use-credits";

// Client-side on purpose: a first-time visitor has no session at all, and a
// guest's session cookie is written by the browser. Reading here means the list
// behaves identically for a guest and a signed-in client.
//
// Only the signed-in user's own projects (decision 6a): RLS lets a super_admin
// read everyone's, and that view lives at /dashboard/projects.
//
// Active vs archived (0042): at most 3 active projects (admin unlimited,
// enforced by a database trigger); archiving one frees a slot. Before 0042
// there is no status column: every project counts as active and the archive
// controls stay hidden.

type CardProject = Pick<Project, "id" | "name" | "brief" | "created_at"> & {
  partCount: number;
  status: ProjectStatusKind;
  archived: boolean;
};

type ListRow = Pick<Project, "id" | "name" | "brief" | "created_at"> & { status?: string };

type ProjectIdRow = { project_id: string | null };
type OrderLineRow = {
  project_id: string | null;
  order: { status: string } | { status: string }[] | null;
};

export function ProjectList() {
  const t = useTranslations("Projects");
  const format = useFormatter();
  const [projects, setProjects] = useState<CardProject[] | null>(null);
  const [error, setError] = useState(false);
  const [hasStatus, setHasStatus] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [limitHit, setLimitHit] = useState(false);
  const [reload, setReload] = useState(0);
  // A real account (not a guest / no session): hides the "sign in to keep
  // projects on every device" prompt in the empty state.
  const [hasAccount, setHasAccount] = useState(false);
  const summary = useCreditSummary();
  const limit = summary ? summary.project_limit : PROJECT_LIMIT;

  const setArchived = useCallback(async (id: string, archived: boolean) => {
    setBusyId(id);
    setLimitHit(false);
    const { error: e } = await createClient()
      .from("projects")
      .update({ status: archived ? "archived" : "active" })
      .eq("id", id);
    setBusyId(null);
    if (e) {
      if (e.message?.includes("project_limit")) setLimitHit(true);
      else setError(true);
      return;
    }
    setReload((n) => n + 1);
    creditsChanged();
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const supabase = createClient();
      const user = await getCurrentUser();

      if (!cancelled) setHasAccount(!!user && user.is_anonymous !== true);

      // No session yet = no projects yet. Don't mint one just to read.
      if (!user) {
        if (!cancelled) setProjects([]);
        return;
      }

      const list = (cols: string) =>
        supabase.from("projects").select(cols).eq("user_id", user.id).order("updated_at", { ascending: false });
      let { data, error: listErr } = await list("id, name, brief, created_at, status");
      const withStatus = !listErr;
      if (listErr) ({ data, error: listErr } = await list("id, name, brief, created_at"));

      if (listErr) {
        if (!cancelled) setError(true);
        return;
      }
      if (!cancelled) setHasStatus(withStatus);

      const rows = (data ?? []) as unknown as ListRow[];
      const ids = rows.map((p) => p.id);
      if (ids.length === 0) {
        if (!cancelled) setProjects([]);
        return;
      }

      // Only project ids come back: enough to count parts and read status.
      const [itemRes, partRes, cartRes, orderRes] = await Promise.all([
        supabase.from("project_items").select("project_id").in("project_id", ids),
        supabase.from("project_parts").select("project_id").in("project_id", ids),
        supabase
          .from("cart_items")
          .select("project_id")
          .eq("user_id", user.id)
          .in("project_id", ids),
        supabase
          .from("part_order_items")
          .select("project_id, order:part_orders(status)")
          .in("project_id", ids),
      ]);

      if (itemRes.error || partRes.error || cartRes.error || orderRes.error) {
        if (!cancelled) setError(true);
        return;
      }

      const tally = (list: ProjectIdRow[]) => {
        const m = new Map<string, number>();
        for (const r of list) if (r.project_id) m.set(r.project_id, (m.get(r.project_id) ?? 0) + 1);
        return m;
      };
      const items = tally((itemRes.data ?? []) as ProjectIdRow[]);
      const parts = tally((partRes.data ?? []) as ProjectIdRow[]);
      const carts = tally((cartRes.data ?? []) as ProjectIdRow[]);
      const ordered = new Set<string>();
      for (const l of (orderRes.data ?? []) as unknown as OrderLineRow[]) {
        const order = Array.isArray(l.order) ? l.order[0] : l.order;
        if (l.project_id && order && order.status !== "cancelled") ordered.add(l.project_id);
      }

      if (!cancelled) {
        setProjects(
          rows.map((p) => ({
            id: p.id,
            name: p.name,
            brief: p.brief,
            created_at: p.created_at,
            archived: p.status === "archived",
            partCount: (items.get(p.id) ?? 0) + (parts.get(p.id) ?? 0),
            status: deriveProjectStatus({
              hasLiveOrder: ordered.has(p.id),
              hasCartLine: (carts.get(p.id) ?? 0) > 0,
            }),
          }))
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [reload]);

  if (error) {
    return (
      <div role="alert" className="neu p-8 text-center sm:p-12">
        <p className="text-base text-destructive">{t("loadFailed")}</p>
      </div>
    );
  }

  if (projects === null) {
    return (
      <div className="neu flex items-center justify-center p-12">
        <Loader2 className="h-5 w-5 animate-spin text-mutedtext" />
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="neu space-y-5 p-8 text-center sm:p-12">
        <p className="text-base text-mutedtext">{t("emptyList")}</p>
        <p className="text-sm italic text-faint">{t("emptyExample")}</p>
        <Button asChild size="lg">
          <Link href="/projects/new">
            <Plus className="me-2 h-4 w-4" />
            {t("newProject")}
          </Link>
        </Button>
        {!hasAccount && (
          <p>
            <Link
              href="/sign-in"
              className="inline-flex min-h-11 items-center text-sm font-semibold text-cobalt underline underline-offset-2 hover:text-cobalt-hover"
            >
              {t("emptySignIn")}
            </Link>
          </p>
        )}
      </div>
    );
  }

  const active = projects.filter((p) => !p.archived);
  const archived = projects.filter((p) => p.archived);
  const full = limit !== null && active.length >= limit;

  const card = (p: CardProject) => (
        <li key={p.id} className="flex flex-col gap-2">
          <Link
            href={`/projects/${p.id}`}
            aria-label={p.name}
            className="neu neu-hover flex h-full flex-col gap-3 p-5 transition-shadow"
          >
            <div className="flex items-start justify-between gap-3">
              <p className="min-w-0 break-words text-base font-semibold text-heading">{p.name}</p>
              <Tag
                variant={p.status === "planning" ? "neutral" : p.status === "ordered" ? "inventory" : "buy"}
                className="shrink-0"
              >
                {t(`card_status_${p.status}`)}
              </Tag>
            </div>
            {p.brief && (
              <p className="line-clamp-2 text-sm text-mutedtext">{p.brief}</p>
            )}
            <p className="mt-auto flex flex-wrap gap-x-3 gap-y-1 text-xs text-mutedtext">
              <time dateTime={p.created_at}>
                {t("card_created", {
                  date: format.dateTime(new Date(p.created_at), { dateStyle: "medium" }),
                })}
              </time>
              <span>{t("card_parts", { count: p.partCount })}</span>
            </p>
          </Link>
          {hasStatus && (
            <button
              type="button"
              onClick={() => setArchived(p.id, !p.archived)}
              disabled={busyId === p.id}
              className="inline-flex w-fit items-center gap-1.5 self-end rounded-lg px-2 py-1 text-xs font-semibold text-mutedtext transition-colors hover:text-heading disabled:opacity-60 max-md:min-h-11"
            >
              {busyId === p.id ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : p.archived ? (
                <ArchiveRestore className="h-3.5 w-3.5" />
              ) : (
                <Archive className="h-3.5 w-3.5" />
              )}
              {p.archived ? t("restore") : t("archive")}
            </button>
          )}
        </li>
  );

  return (
    <div className="space-y-6">
      {hasStatus && limit !== null && (
        <div
          className={
            full
              ? "rounded-xl bg-inventory-bg px-4 py-3 text-sm font-medium text-inventory"
              : "text-xs text-mutedtext"
          }
          role={full ? "status" : undefined}
        >
          {full ? t("limitFull", { used: active.length, limit }) : t("limitUsed", { used: active.length, limit })}
        </div>
      )}
      {limitHit && (
        <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {t("limitRestore", { limit: limit ?? PROJECT_LIMIT })}
        </p>
      )}
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">{active.map(card)}</ul>
      {archived.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm font-semibold text-mutedtext hover:text-heading">
            {t("archivedHeading", { count: archived.length })}
          </summary>
          <ul className="mt-4 grid grid-cols-1 gap-4 opacity-80 sm:grid-cols-2 lg:grid-cols-3">{archived.map(card)}</ul>
        </details>
      )}
    </div>
  );
}
