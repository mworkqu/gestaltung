"use client";

import { useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Loader2, Plus } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import { deriveProjectStatus, type ProjectStatusKind } from "@/lib/projects/item-status";
import { Button } from "@/components/ui/button";
import { Tag } from "@/components/ui/tag";
import type { Project } from "@/lib/supabase/types";

// Client-side on purpose: a first-time visitor has no session at all, and a
// guest's session cookie is written by the browser. Reading here means the list
// behaves identically for a guest and a signed-in client.
//
// Only the signed-in user's own projects (decision 6a): RLS lets a super_admin
// read everyone's, and that view lives at /dashboard/projects.

type CardProject = Pick<Project, "id" | "name" | "brief" | "created_at"> & {
  partCount: number;
  status: ProjectStatusKind;
};

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

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      // No session yet = no projects yet. Don't mint one just to read.
      if (!user) {
        if (!cancelled) setProjects([]);
        return;
      }

      const { data, error: listErr } = await supabase
        .from("projects")
        .select("id, name, brief, created_at")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false });

      if (listErr) {
        if (!cancelled) setError(true);
        return;
      }

      const rows = (data ?? []) as Pick<Project, "id" | "name" | "brief" | "created_at">[];
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
            ...p,
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
  }, []);

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
        <Button asChild size="lg">
          <Link href="/projects/new">
            <Plus className="me-2 h-4 w-4" />
            {t("newProject")}
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {projects.map((p) => (
        <li key={p.id}>
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
        </li>
      ))}
    </ul>
  );
}
