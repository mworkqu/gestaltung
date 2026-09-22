"use client";

// The left column: the project as a tree of what it actually needs.
//
// No padlocks. A node that cannot proceed says why in words, and clicking it
// goes to the place that resolves it. Counts come from nodeStates(), which maps
// the readiness requirements onto nodes — nothing is counted here. Indentation
// uses logical properties (ms-/ps-/border-s) so the tree mirrors in Arabic.

import { useTranslations } from "next-intl";
import { ClipboardList, Cpu, Factory, Layers, Lightbulb, Plus, Receipt, SquareCode, Wrench, X } from "lucide-react";

import type { Discipline } from "@/lib/prototyping/constants";
import {
  LEAVES,
  nodeKey,
  type Branch,
  type NodeId,
  type NodeState,
} from "@/lib/prototyping/tree";
import { Tag } from "@/components/ui/tag";
import { useMono } from "@/components/prototyping/ui";
import { cn } from "@/lib/utils";

const BRANCH_ICON: Record<Discipline, typeof Wrench> = {
  mechanical: Wrench,
  electronics: Cpu,
  software: SquareCode,
};

function OpenBadge({ count }: { count: number }) {
  const t = useTranslations("Prototyping");
  if (!count) return null;
  return (
    <span
      aria-label={t("openItems", { count })}
      className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-inventory-bg px-1.5 font-mono text-[10px] font-semibold tabular-nums text-inventory"
    >
      {count}
    </span>
  );
}

export function TreeNav({
  branches,
  states,
  current,
  collapsed,
  saveFailed,
  onSelect,
  onBranch,
}: {
  branches: Branch[];
  states: Record<NodeId, NodeState>;
  current: NodeId;
  collapsed: boolean;
  saveFailed: boolean;
  /** Go to a node, optionally focusing the control that resolves it. */
  onSelect: (n: NodeId, focus?: string) => void;
  onBranch: (d: Discipline, on: boolean) => void;
}) {
  const t = useTranslations("Prototyping");
  const mono = useMono();
  const active = branches.filter((b) => b.active);
  const inactive = branches.filter((b) => !b.active);
  const openAt = (n: NodeId) => states[n]?.open.length ?? 0;
  const branchOpen = (d: Discipline) => LEAVES[d].reduce((a, n) => a + openAt(n), 0);

  if (collapsed) {
    const top: { id: string; icon: typeof Wrench; to: NodeId; open: number; label: string }[] = [
      { id: "brief", icon: Lightbulb, to: "brief", open: openAt("brief"), label: t("node_brief") },
      { id: "parts", icon: Layers, to: "parts", open: openAt("parts"), label: t("node_parts") },
      { id: "bom", icon: ClipboardList, to: "bom", open: openAt("bom"), label: t("node_bom") },
      ...active.map((b) => ({
        id: b.discipline,
        icon: BRANCH_ICON[b.discipline],
        to: LEAVES[b.discipline][0] as NodeId,
        open: branchOpen(b.discipline),
        label: t(`discipline_${b.discipline}`),
      })),
      { id: "quote", icon: Receipt, to: "quote", open: openAt("quote"), label: t("node_quote") },
      {
        id: "production",
        icon: Factory,
        to: "production",
        open: openAt("production"),
        label: t("node_production"),
      },
    ];
    return (
      <ul className="flex flex-col items-center gap-1.5">
        {top.map(({ id, icon: Icon, to, open, label }) => (
          <li key={id}>
            <button
              type="button"
              onClick={() => onSelect(to)}
              title={label}
              aria-label={label}
              className="relative grid h-9 w-9 place-items-center rounded-xl bg-surface shadow-neu-sm transition-colors hover:text-cobalt"
            >
              <Icon className="h-4 w-4 text-cobalt" strokeWidth={1.6} />
              {open > 0 && (
                <span className="absolute -end-0.5 -top-0.5 h-2 w-2 rounded-full bg-inventory ring-2 ring-surface" />
              )}
            </button>
          </li>
        ))}
      </ul>
    );
  }

  /** One clickable node. Goes to the fix when the cause lives elsewhere. */
  function Node({ n, icon: Icon }: { n: NodeId; icon?: typeof Wrench }) {
    const st = states[n] ?? { open: [] };
    const here = current === n;
    return (
      <button
        type="button"
        onClick={() => (st.reason && st.target ? onSelect(st.target, st.focus) : onSelect(n))}
        aria-current={here ? "page" : undefined}
        className={cn(
          "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start transition-colors",
          here ? "bg-panel text-heading shadow-neu-inset" : "text-mutedtext hover:text-heading"
        )}
      >
        {Icon && <Icon className="h-4 w-4 shrink-0 text-cobalt" strokeWidth={1.6} />}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold">{t(nodeKey(n))}</span>
          {st.reason && (
            <span className="block truncate text-[10.5px] font-medium text-inventory">
              {st.reason}
            </span>
          )}
        </span>
        <OpenBadge count={st.open.length} />
      </button>
    );
  }

  return (
    <div className="space-y-3">
      <p className={mono("px-2 text-[10px] text-faint")}>{t("treeRoot")}</p>

      <ul className="space-y-1">
        <li>
          <Node n="brief" icon={Lightbulb} />
        </li>
        <li>
          <Node n="parts" icon={Layers} />
        </li>
        <li>
          <Node n="bom" icon={ClipboardList} />
        </li>

        {active.map((b) => {
          const Icon = BRANCH_ICON[b.discipline];
          const name = t(`discipline_${b.discipline}`);
          const blocked = b.partCount > 0;
          return (
            <li key={b.discipline} className="space-y-0.5 pt-1">
              <div className="flex items-center gap-1 px-2">
                <Icon className="h-4 w-4 shrink-0 text-cobalt" strokeWidth={1.6} />
                <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-heading">
                  {name}
                </span>
                {b.manual && !b.detected && <Tag variant="neutral">{t("addedByYou")}</Tag>}
                <OpenBadge count={branchOpen(b.discipline)} />
                {/* Wrapper carries the reason: disabled buttons swallow hover. */}
                <span
                  title={
                    blocked
                      ? t("cantRemoveBranch", { count: b.partCount })
                      : t("removeBranch", { branch: name })
                  }
                >
                  <button
                    type="button"
                    onClick={() => onBranch(b.discipline, false)}
                    disabled={blocked}
                    aria-label={t("removeBranch", { branch: name })}
                    className="grid h-5 w-5 place-items-center rounded text-faint transition-colors hover:text-destructive disabled:opacity-40 disabled:hover:text-faint"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              </div>
              <ul className="ms-4 space-y-0.5 border-s border-borderstrong/60 ps-2">
                {LEAVES[b.discipline].map((n) => (
                  <li key={n}>
                    <Node n={n} />
                  </li>
                ))}
              </ul>
            </li>
          );
        })}

        <li className="pt-1">
          <Node n="quote" icon={Receipt} />
        </li>
        <li>
          <Node n="production" icon={Factory} />
        </li>
      </ul>

      {inactive.length > 0 && (
        <div className="space-y-1.5 border-t border-borderstrong/40 px-2 pt-3">
          <p className="text-[11px] text-mutedtext">{t("addBranch")}</p>
          <div className="flex flex-wrap gap-1.5">
            {inactive.map((b) => (
              <button
                key={b.discipline}
                type="button"
                onClick={() => onBranch(b.discipline, true)}
                className="inline-flex items-center gap-1 rounded-lg bg-panel px-2.5 py-1 text-[11px] font-semibold text-heading shadow-neu-sm transition-colors hover:text-cobalt"
              >
                <Plus className="h-3 w-3" />
                {t(`discipline_${b.discipline}`)}
              </button>
            ))}
          </div>
        </div>
      )}

      {saveFailed && (
        <p className="px-2 text-[11px] font-medium text-destructive">{t("branchSaveFailed")}</p>
      )}
    </div>
  );
}
