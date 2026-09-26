"use client";

// The left column: the project as a tree of what it actually needs.
//
// No padlocks. A node that cannot proceed says why in words — under its label
// and as a tooltip — and clicking it goes to the place that resolves it; a
// click is never dead (see nodeClick). Counts come from nodeStates(), which
// maps the readiness requirements onto nodes — nothing is counted here.
// Indentation uses logical properties (ms-/ps-/border-s) so the tree mirrors in
// Arabic. Every row is a real <button>; ↑/↓/Home/End move between rows.
//
// Removing a discipline is two steps and can be undone for a few seconds
// (audit #40): the "×" asks first, then an inline bar offers Undo.

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useTranslations } from "next-intl";
import {
  Check,
  ClipboardList,
  Cpu,
  Factory,
  Layers,
  Lightbulb,
  Plus,
  Receipt,
  SquareCode,
  Undo2,
  Wrench,
  X,
} from "lucide-react";

import type { Discipline } from "@/lib/prototyping/constants";
import { nodeClick } from "@/lib/prototyping/node-click";
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

/** How long the Undo bar stays after a branch is removed. */
const UNDO_MS = 6000;

const FOCUS_RING =
  "outline-none focus-visible:ring-2 focus-visible:ring-cobalt/60 focus-visible:ring-offset-1 focus-visible:ring-offset-surface";

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

/** ↑/↓/Home/End between the tree's rows. Tab still walks every control. */
function moveBetweenRows(e: KeyboardEvent<HTMLElement>) {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
  const rows = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("[data-tree-row]"));
  const i = rows.indexOf(document.activeElement as HTMLElement);
  if (i < 0 || !rows.length) return;
  e.preventDefault();
  const next =
    e.key === "Home"
      ? 0
      : e.key === "End"
        ? rows.length - 1
        : (i + (e.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length;
  rows[next]?.focus();
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

  /** "Concepts" alone is ambiguous across branches, so leaves name their branch. */
  const nodeLabel = (n: NodeId) => {
    const [d, leaf] = n.split(".");
    return leaf ? `${t(`discipline_${d}`)} · ${t(nodeKey(n))}` : t(nodeKey(n));
  };

  /** What a row says about itself: accessible name, tooltip, and where a click goes. */
  const describe = (n: NodeId, label = nodeLabel(n)) => {
    const st = states[n];
    const go = nodeClick(n, st, current);
    const reason = st?.reason;
    return {
      go,
      reason,
      ariaLabel: reason
        ? t("nodeBlocked", { label, reason })
        : t("nodeState", { label, count: st?.open.length ?? 0 }),
      // "Click to open X" only when the click really moves you; already on the
      // fix, it just brings the control into view.
      title: reason
        ? go.to !== n && go.to !== current
          ? t("nodeFixHint", { reason, target: nodeLabel(go.to) })
          : reason
        : label,
    };
  };

  // Branch removal: which "×" is asking, and which removal can still be undone.
  const [confirming, setConfirming] = useState<Discipline | null>(null);
  const [removed, setRemoved] = useState<Discipline | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const removeRefs = useRef<Partial<Record<Discipline, HTMLButtonElement | null>>>({});
  const addRefs = useRef<Partial<Record<Discipline, HTMLButtonElement | null>>>({});
  const undoRef = useRef<HTMLButtonElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const undoMsgId = useId();

  useEffect(() => () => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
  }, []);

  // The least destructive choice takes focus when the question appears.
  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
  }, [confirming]);

  function cancelRemove(d: Discipline) {
    setConfirming(null);
    // Back to the "×" once it has re-rendered.
    setTimeout(() => removeRefs.current[d]?.focus(), 0);
  }

  function confirmRemove(d: Discipline) {
    setConfirming(null);
    onBranch(d, false);
    setRemoved(d);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => {
      // Don't strand keyboard focus on a bar that is about to vanish.
      if (document.activeElement === undoRef.current) addRefs.current[d]?.focus();
      setRemoved(null);
    }, UNDO_MS);
    setTimeout(() => undoRef.current?.focus(), 0);
  }

  function undoRemove(d: Discipline) {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setRemoved(null);
    // The only way back the workspace offers is "add": it records a manual
    // "on", which shows the branch exactly as before (a removable branch holds
    // no parts, so it was on because it was detected or added by hand).
    onBranch(d, true);
    setTimeout(() => removeRefs.current[d]?.focus(), 0);
  }

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
      <nav aria-label={t("treeRoot")} onKeyDown={moveBetweenRows}>
        <ul className="flex flex-col items-center gap-1.5">
          {top.map(({ id, icon: Icon, to, open, label }) => {
            // A branch icon stands for the whole branch, not its first leaf:
            // its name carries the branch's open count and it is "current"
            // on any of its leaves.
            const isBranch = to.includes(".");
            const { go, ariaLabel, title } = isBranch
              ? {
                  go: { to, focus: undefined },
                  ariaLabel: t("nodeState", { label, count: open }),
                  title: label,
                }
              : describe(to, label);
            const here = isBranch ? current.startsWith(`${id}.`) : current === to;
            return (
              <li key={id}>
                <button
                  type="button"
                  data-tree-row
                  onClick={() => onSelect(go.to, go.focus)}
                  title={title}
                  aria-label={ariaLabel}
                  aria-current={here ? "page" : undefined}
                  className={cn(
                    "relative grid h-9 w-9 place-items-center rounded-xl bg-surface shadow-neu-sm transition-colors hover:text-cobalt",
                    FOCUS_RING
                  )}
                >
                  <Icon className="h-4 w-4 text-cobalt" strokeWidth={1.6} />
                  {open > 0 && (
                    <span className="absolute -end-0.5 -top-0.5 h-2 w-2 rounded-full bg-inventory ring-2 ring-surface" />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    );
  }

  // Rows are render functions, not inner components: an inner component is a
  // new type every render, so React would remount the row and drop keyboard focus.

  /** One clickable node. Goes to the fix when the cause lives elsewhere. */
  function node(n: NodeId, Icon?: typeof Wrench) {
    const st = states[n] ?? { open: [] };
    const here = current === n;
    const { go, reason, ariaLabel, title } = describe(n);
    return (
      <button
        type="button"
        data-tree-row
        onClick={() => onSelect(go.to, go.focus)}
        aria-current={here ? "page" : undefined}
        aria-label={ariaLabel}
        title={title}
        className={cn(
          "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start transition-colors",
          FOCUS_RING,
          here ? "bg-panel text-heading shadow-neu-inset" : "text-mutedtext hover:text-heading"
        )}
      >
        {Icon && <Icon className="h-4 w-4 shrink-0 text-cobalt" strokeWidth={1.6} />}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold">{t(nodeKey(n))}</span>
          {reason && (
            // Wraps rather than truncates: the reason is the point of the row.
            <span className="block break-words text-[10.5px] font-medium leading-snug text-mutedtext">
              {reason}
            </span>
          )}
        </span>
        <OpenBadge count={st.open.length} />
      </button>
    );
  }

  function branchRow(b: Branch) {
    const d = b.discipline;
    const Icon = BRANCH_ICON[d];
    const name = t(`discipline_${d}`);
    const blocked = b.partCount > 0;
    const asking = confirming === d;
    return (
      <li key={d} className="space-y-0.5 pt-1">
        <div className="group/branch flex items-center gap-1 px-2">
          <Icon className="h-4 w-4 shrink-0 text-cobalt" strokeWidth={1.6} />
          <span className="min-w-0 truncate text-[13px] font-bold text-heading">{name}</span>
          {b.manual && !b.detected && <Tag variant="neutral">{t("addedByYou")}</Tag>}
          <OpenBadge count={branchOpen(d)} />
          <span className="flex-1" />
          {/* Row end, away from the badge. Hidden until hover on pointer
              devices, always shown on touch, and always shown on focus. */}
          {!asking && (
            <button
              ref={(el) => {
                removeRefs.current[d] = el;
              }}
              type="button"
              onClick={() => setConfirming(d)}
              title={blocked ? t("cantRemoveBranch", { count: b.partCount }) : t("removeBranch", { branch: name })}
              aria-label={t("removeBranch", { branch: name })}
              className={cn(
                "grid h-6 w-6 shrink-0 place-items-center rounded text-faint transition-[color,opacity] hover:text-destructive",
                "[@media(hover:hover)]:opacity-0 focus-visible:opacity-100 group-hover/branch:opacity-100",
                FOCUS_RING
              )}
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        {asking && (
          // A branch that still holds parts can't go: say why instead of asking.
          <div
            role={blocked ? "status" : "group"}
            aria-label={blocked ? undefined : t("removeBranchConfirm", { branch: name })}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                cancelRemove(d);
              }
            }}
            className="ms-4 flex items-center gap-1.5 rounded-lg bg-panel px-2 py-1 shadow-neu-inset"
          >
            <span className="min-w-0 flex-1 text-[11px] font-medium text-heading">
              {blocked
                ? t("cantRemoveBranch", { count: b.partCount })
                : t("removeBranchConfirm", { branch: name })}
            </span>
            {!blocked && (
              <button
                type="button"
                onClick={() => confirmRemove(d)}
                title={t("confirmYes")}
                aria-label={t("confirmYes")}
                className={cn(
                  "grid h-6 w-6 shrink-0 place-items-center rounded text-destructive transition-colors hover:bg-destructive/10",
                  FOCUS_RING
                )}
              >
                <Check className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              ref={cancelRef}
              type="button"
              onClick={() => cancelRemove(d)}
              title={t("confirmNo")}
              aria-label={t("confirmNo")}
              className={cn(
                "grid h-6 w-6 shrink-0 place-items-center rounded text-mutedtext transition-colors hover:text-heading",
                FOCUS_RING
              )}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        <ul className="ms-4 space-y-0.5 border-s border-borderstrong/60 ps-2">
          {LEAVES[d].map((n) => (
            <li key={n}>{node(n)}</li>
          ))}
        </ul>
      </li>
    );
  }

  return (
    <nav aria-label={t("treeRoot")} className="space-y-3" onKeyDown={moveBetweenRows}>
      <p className={mono("px-2 text-[10px] text-faint")}>{t("treeRoot")}</p>

      <ul className="space-y-1">
        <li>
          {node("brief", Lightbulb)}
        </li>
        <li>
          {node("parts", Layers)}
        </li>
        <li>
          {node("bom", ClipboardList)}
        </li>

        {/* In tree order, so the Undo bar sits where the branch was. */}
        {branches.map((b) =>
          b.active ? (
            branchRow(b)
          ) : removed === b.discipline ? (
            <li key={b.discipline} className="pt-1">
              <div
                role="status"
                className="flex items-center gap-2 rounded-lg bg-panel px-2 py-1.5 shadow-neu-inset"
              >
                <span id={undoMsgId} className="min-w-0 flex-1 text-[11px] font-medium text-heading">
                  {t("removedBranch", { branch: t(`discipline_${b.discipline}`) })}
                </span>
                <button
                  ref={undoRef}
                  type="button"
                  aria-describedby={undoMsgId}
                  onClick={() => undoRemove(b.discipline)}
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-cobalt transition-colors hover:bg-cobalt/10",
                    FOCUS_RING
                  )}
                >
                  <Undo2 className="h-3 w-3" />
                  {t("undo")}
                </button>
              </div>
            </li>
          ) : null
        )}

        <li className="pt-1">
          {node("quote", Receipt)}
        </li>
        <li>
          {node("production", Factory)}
        </li>
      </ul>

      {inactive.length > 0 && (
        <div className="space-y-1.5 border-t border-borderstrong/40 px-2 pt-3">
          <p className="text-[11px] text-mutedtext">{t("addBranch")}</p>
          <div className="flex flex-wrap gap-1.5">
            {inactive.map((b) => (
              <button
                key={b.discipline}
                ref={(el) => {
                  addRefs.current[b.discipline] = el;
                }}
                type="button"
                onClick={() => onBranch(b.discipline, true)}
                className={cn(
                  "inline-flex items-center gap-1 rounded-lg bg-panel px-2.5 py-1 text-[11px] font-semibold text-heading shadow-neu-sm transition-colors hover:text-cobalt",
                  FOCUS_RING
                )}
              >
                <Plus className="h-3 w-3" />
                {t(`discipline_${b.discipline}`)}
              </button>
            ))}
          </div>
        </div>
      )}

      {saveFailed && (
        <p role="alert" className="px-2 text-[11px] font-medium text-destructive">
          {t("branchSaveFailed")}
        </p>
      )}
    </nav>
  );
}
