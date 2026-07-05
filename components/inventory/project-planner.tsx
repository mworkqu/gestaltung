"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Plus,
  Trash2,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  CheckCircle2,
  Package,
} from "lucide-react";

import { cn } from "@/lib/utils";

// A lightweight project-planning board for inventory (store-first Stage 4).
// Projects group inventory items into a bill of materials, flag short stock,
// and move across a Planned → In progress → Done kanban. Intentionally NO new
// DB table: projects live in this browser's localStorage (a planning aid);
// current stock is read live from inventory_items (passed in from the server).
// If shared/persistent projects are needed later, that requires a table.

export type InventoryLite = {
  id: string;
  sku: string;
  name: string;
  quantity: number;
  unit: string;
};

type Status = "planned" | "in_progress" | "done";
type BomRow = { itemId: string; qty: number };
type Project = { id: string; name: string; status: Status; bom: BomRow[] };

const STORAGE_KEY = "gestaltung:inventory-projects";
const ORDER: Status[] = ["planned", "in_progress", "done"];

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    // Fallback for older browsers — uniqueness is only needed within this list.
    return "p-" + Date.now().toString(36) + "-" + performance.now().toString(36);
  }
}

export function ProjectPlanner({ items }: { items: InventoryLite[] }) {
  const t = useTranslations("Inventory");
  const [projects, setProjects] = useState<Project[]>([]);
  const [ready, setReady] = useState(false);
  const [draft, setDraft] = useState("");

  const itemMap = useMemo(() => {
    const m = new Map<string, InventoryLite>();
    items.forEach((i) => m.set(i.id, i));
    return m;
  }, [items]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) setProjects(JSON.parse(raw) as Project[]);
    } catch {
      /* ignore malformed storage */
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (ready) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
      } catch {
        /* storage full/unavailable — board still works for this view */
      }
    }
  }, [projects, ready]);

  function addProject(e: React.FormEvent) {
    e.preventDefault();
    const name = draft.trim();
    if (!name) return;
    setProjects((p) => [
      { id: newId(), name, status: "planned", bom: [] },
      ...p,
    ]);
    setDraft("");
  }

  const update = (id: string, fn: (p: Project) => Project) =>
    setProjects((list) => list.map((p) => (p.id === id ? fn(p) : p)));

  const deleteProject = (id: string) =>
    setProjects((list) => list.filter((p) => p.id !== id));

  const move = (id: string, dir: -1 | 1) =>
    update(id, (p) => {
      const i = ORDER.indexOf(p.status);
      const next = ORDER[Math.min(ORDER.length - 1, Math.max(0, i + dir))];
      return { ...p, status: next };
    });

  const addBomRow = (id: string, itemId: string) =>
    update(id, (p) =>
      p.bom.some((r) => r.itemId === itemId)
        ? p
        : { ...p, bom: [...p.bom, { itemId, qty: 1 }] }
    );

  const setQty = (id: string, itemId: string, qty: number) =>
    update(id, (p) => ({
      ...p,
      bom: p.bom.map((r) => (r.itemId === itemId ? { ...r, qty } : r)),
    }));

  const removeRow = (id: string, itemId: string) =>
    update(id, (p) => ({ ...p, bom: p.bom.filter((r) => r.itemId !== itemId) }));

  const isShort = (p: Project) =>
    p.bom.some((r) => r.qty > (itemMap.get(r.itemId)?.quantity ?? 0));

  if (!ready) return <div className="py-16" />;

  const statusLabel: Record<Status, string> = {
    planned: t("status_planned"),
    in_progress: t("status_in_progress"),
    done: t("status_done"),
  };

  return (
    <div className="space-y-6">
      {/* Create project */}
      <form onSubmit={addProject} className="flex flex-col gap-3 sm:flex-row">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t("newProjectPlaceholder")}
          className="w-full flex-1 rounded-xl border border-white/60 bg-panel px-4 py-3 text-sm text-heading shadow-neu-inset outline-none transition placeholder:text-faint focus:ring-2 focus:ring-cobalt/60"
        />
        <button
          type="submit"
          className="inline-flex items-center justify-center gap-2 rounded-full bg-cobalt px-6 py-3 text-sm font-semibold text-white shadow-neu-sm transition hover:bg-cobalt-hover"
        >
          <Plus className="h-4 w-4" />
          {t("addProject")}
        </button>
      </form>

      <p className="text-[11px] text-faint">{t("projectsLocalNote")}</p>

      {items.length === 0 && (
        <div className="neu flex flex-col items-center gap-3 p-10 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-panel shadow-neu-sm">
            <Package className="h-6 w-6 text-cobalt" strokeWidth={1.5} />
          </span>
          <p className="text-sm font-semibold text-heading">{t("noItemsTitle")}</p>
          <p className="max-w-sm text-sm text-mutedtext">{t("noItemsBody")}</p>
        </div>
      )}

      {/* Kanban */}
      <div className="grid gap-4 lg:grid-cols-3">
        {ORDER.map((status) => {
          const col = projects.filter((p) => p.status === status);
          return (
            <section key={status} className="neu-inset space-y-3 p-3">
              <header className="flex items-center justify-between px-1 py-1">
                <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-mutedtext">
                  {statusLabel[status]}
                </span>
                <span className="rounded-full bg-panel px-2 py-0.5 font-mono text-[10px] text-faint shadow-neu-sm">
                  {col.length}
                </span>
              </header>

              {col.length === 0 && (
                <p className="px-1 py-6 text-center text-xs text-faint">
                  {t("columnEmpty")}
                </p>
              )}

              {col.map((project) => {
                const short = isShort(project);
                const idx = ORDER.indexOf(status);
                const available = items.filter(
                  (i) => !project.bom.some((r) => r.itemId === i.id)
                );
                return (
                  <article
                    key={project.id}
                    className="space-y-3 rounded-xl bg-surface p-4 shadow-neu-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-sm font-bold text-heading">
                        {project.name}
                      </h3>
                      <button
                        type="button"
                        onClick={() => deleteProject(project.id)}
                        aria-label={t("deleteProject")}
                        className="text-mutedtext transition-colors hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>

                    {/* BOM rows */}
                    {project.bom.length > 0 && (
                      <ul className="space-y-2">
                        {project.bom.map((row) => {
                          const item = itemMap.get(row.itemId);
                          const stock = item?.quantity ?? 0;
                          const rowShort = row.qty > stock;
                          return (
                            <li
                              key={row.itemId}
                              className="flex items-center gap-2 rounded-lg bg-panel px-2.5 py-2"
                            >
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-xs font-medium text-heading">
                                  {item?.name ?? t("removedItem")}
                                </p>
                                <p className="font-mono text-[10px] text-faint">
                                  {t("stockLabel", { qty: stock })}
                                  {item ? ` ${item.unit}` : ""}
                                </p>
                              </div>
                              <input
                                type="number"
                                min={1}
                                value={row.qty}
                                aria-label={t("qtyNeededAria")}
                                onChange={(e) =>
                                  setQty(
                                    project.id,
                                    row.itemId,
                                    Math.max(1, Math.floor(Number(e.target.value) || 1))
                                  )
                                }
                                className="w-14 rounded-md border border-white/60 bg-surface px-2 py-1 text-center text-xs tabular-nums text-heading shadow-neu-inset outline-none focus:ring-1 focus:ring-cobalt/60"
                              />
                              <span
                                className={cn(
                                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
                                  rowShort
                                    ? "bg-destructive/10 text-destructive"
                                    : "bg-emerald-500/10 text-emerald-600"
                                )}
                                title={rowShort ? t("flagShort") : t("flagOk")}
                              >
                                {rowShort ? (
                                  <AlertTriangle className="h-3.5 w-3.5" />
                                ) : (
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                )}
                              </span>
                              <button
                                type="button"
                                onClick={() => removeRow(project.id, row.itemId)}
                                aria-label={t("removeBomRow")}
                                className="text-faint transition-colors hover:text-destructive"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}

                    {/* Add item to BOM */}
                    {available.length > 0 && (
                      <select
                        value=""
                        onChange={(e) => {
                          if (e.target.value) addBomRow(project.id, e.target.value);
                        }}
                        className="w-full rounded-lg border border-white/60 bg-panel px-2.5 py-2 text-xs text-mutedtext shadow-neu-inset outline-none focus:ring-1 focus:ring-cobalt/60"
                      >
                        <option value="">{t("addBomItem")}</option>
                        {available.map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.name} — {i.sku}
                          </option>
                        ))}
                      </select>
                    )}

                    {/* Footer: short badge + move controls */}
                    <div className="flex items-center justify-between gap-2 pt-1">
                      {project.bom.length > 0 ? (
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                            short
                              ? "bg-destructive/10 text-destructive"
                              : "bg-emerald-500/10 text-emerald-600"
                          )}
                        >
                          {short ? (
                            <AlertTriangle className="h-3 w-3" />
                          ) : (
                            <CheckCircle2 className="h-3 w-3" />
                          )}
                          {short ? t("projectShort") : t("projectReady")}
                        </span>
                      ) : (
                        <span />
                      )}
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => move(project.id, -1)}
                          disabled={idx === 0}
                          aria-label={t("moveBack")}
                          className="flex h-7 w-7 items-center justify-center rounded-full bg-panel text-mutedtext shadow-neu-sm transition hover:text-heading disabled:opacity-30"
                        >
                          <ChevronLeft className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => move(project.id, 1)}
                          disabled={idx === ORDER.length - 1}
                          aria-label={t("moveForward")}
                          className="flex h-7 w-7 items-center justify-center rounded-full bg-panel text-mutedtext shadow-neu-sm transition hover:text-heading disabled:opacity-30"
                        >
                          <ChevronRight className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </section>
          );
        })}
      </div>
    </div>
  );
}
