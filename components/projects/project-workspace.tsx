"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ImagePlus,
  Loader2,
  Sparkles,
  Trash2,
  Type as TypeIcon,
} from "lucide-react";

import { Link, useRouter } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import { ensureSession, getCurrentUser, isGuest } from "@/lib/supabase/guest";
import { formatPrice, partName } from "@/lib/parts/format";
import {
  MAX_PROJECT_IMAGE_BYTES,
  PROJECT_IMAGE_ACCEPT,
  PROJECT_IMAGE_BUCKET,
} from "@/lib/projects/constants";
import {
  adjustCart,
  ownedCount,
  returnToInventory,
  splitOnAdd,
  splitOnRemove,
  takeFromInventory,
} from "@/lib/projects/allocation";
import {
  deriveItemStatus,
  type ItemStatus,
  type StatusCartRow,
  type StatusOrderLine,
} from "@/lib/projects/item-status";
import { activeLines, type LineMatch, type ProjectBom } from "@/lib/prototyping/bom";
import { costState, toBuyNow } from "@/lib/prototyping/bom-cost";
import { ProjectCadCard } from "@/components/projects/project-cad-card";
import { UnifiedSearch, type SearchHit } from "@/components/search/unified-search";
import { Skeleton } from "@/components/ui/skeleton";
import { Tag } from "@/components/ui/tag";
import { ProjectUnavailable } from "@/components/projects/project-unavailable";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  Part,
  Project,
  ProjectBlock,
  ProjectItem,
} from "@/lib/supabase/types";

// The project workspace. Everything reads and writes through the browser
// client so a guest and a signed-in client behave identically — RLS scopes both
// to their own auth.uid(). On top of RLS the project is read with
// user_id = the signed-in user: a super_admin's RLS read of everyone's
// projects belongs to /dashboard/projects, not here (decision 6a).

type ItemWithPart = ProjectItem & { part: Part | null };

type OrderLineRow = {
  part_id: string;
  quantity: number;
  order: StatusOrderLine["order"] | StatusOrderLine["order"][];
};

export function ProjectWorkspace({ projectId }: { projectId: string }) {
  const t = useTranslations("Projects");
  const router = useRouter();
  const isRtl = useLocale() === "ar";

  const [project, setProject] = useState<Project | null>(null);
  const [blocks, setBlocks] = useState<ProjectBlock[]>([]);
  const [items, setItems] = useState<ItemWithPart[]>([]);
  const [cartRows, setCartRows] = useState<StatusCartRow[]>([]);
  const [orderLines, setOrderLines] = useState<StatusOrderLine[]>([]);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [guest, setGuest] = useState(false);
  const [guestPhone, setGuestPhone] = useState<string | null>(null);
  // No session, or an anonymous one: the not-available state offers sign-in.
  const [signedIn, setSignedIn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  // The project row itself failed to load (not "not yours" — a real error).
  const [fatalError, setFatalError] = useState(false);
  // Something around the project (items, cart, orders…) failed to load.
  const [partialError, setPartialError] = useState(false);

  const load = useCallback(async () => {
    const supabase = createClient();
    const user = await getCurrentUser();
    setGuest(isGuest(user));
    if (user && isGuest(user)) {
      const { data: prof } = await supabase.from("profiles").select("phone").eq("id", user.id).maybeSingle();
      setGuestPhone((prof?.phone as string | null) || null);
    }
    setSignedIn(!!user && !isGuest(user));

    // No session at all: nothing can be theirs. Don't mint one just to read.
    if (!user) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    const { data: proj, error: projErr } = await supabase
      .from("projects")
      .select("*")
      .eq("id", projectId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (projErr) {
      setFatalError(true);
      setLoading(false);
      return;
    }
    if (!proj) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    setProject(proj as Project);

    const [blockRes, itemRes, cartRes, orderRes] = await Promise.all([
      supabase
        .from("project_blocks")
        .select("*")
        .eq("project_id", projectId)
        .order("position", { ascending: true }),
      supabase
        .from("project_items")
        .select("*, part:parts(*)")
        .eq("project_id", projectId)
        .order("created_at", { ascending: true }),
      // Cart lines tagged with this project (RLS: own cart only).
      supabase
        .from("cart_items")
        .select("product_id, quantity")
        .eq("user_id", user.id)
        .eq("project_id", projectId),
      // Order lines placed for this project (0025). RLS only returns lines of
      // orders the caller placed (part_orders.profile_id = auth.uid()).
      supabase
        .from("part_order_items")
        .select("part_id, quantity, order:part_orders(id, status, created_at)")
        .eq("project_id", projectId),
    ]);

    setPartialError(
      !!(blockRes.error || itemRes.error || cartRes.error || orderRes.error)
    );

    const loadedBlocks = (blockRes.data ?? []) as ProjectBlock[];
    setBlocks(loadedBlocks);
    setItems((itemRes.data ?? []) as ItemWithPart[]);
    setCartRows((cartRes.data ?? []) as StatusCartRow[]);
    setOrderLines(
      ((orderRes.data ?? []) as unknown as OrderLineRow[]).map((l) => ({
        part_id: l.part_id,
        quantity: l.quantity,
        order: Array.isArray(l.order) ? (l.order[0] ?? null) : l.order,
      }))
    );

    // The bucket is private, so every image needs a short-lived signed URL.
    const paths = loadedBlocks
      .filter((b) => b.type === "image" && b.storage_path)
      .map((b) => b.storage_path as string);
    if (paths.length) {
      const { data: signed, error: signErr } = await supabase.storage
        .from(PROJECT_IMAGE_BUCKET)
        .createSignedUrls(paths, 3600);
      if (signErr) setPartialError(true);
      const map: Record<string, string> = {};
      (signed ?? []).forEach((s) => {
        if (s.path && s.signedUrl) map[s.path] = s.signedUrl;
      });
      setImageUrls(map);
    }

    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <ProjectSkeleton label={t("loadingProject")} />;

  if (fatalError) {
    return (
      <div role="alert" className="neu space-y-5 p-10 text-center">
        <p className="text-base text-destructive">{t("loadFailed")}</p>
        <Button asChild>
          <Link href="/projects">{t("listHeading")}</Link>
        </Button>
      </div>
    );
  }

  // Not theirs, deleted, or never existed — RLS makes these look the same, and
  // they should: a foreign project must not be confirmed to exist (audit #9).
  if (notFound || !project) {
    return (
      <div className="neu p-10 text-center">
        <ProjectUnavailable signedIn={signedIn}>
          <div className="space-y-3">
            <h1 className="text-xl font-bold text-heading">{t("notAvailableTitle")}</h1>
            <p className="mx-auto max-w-md text-base text-mutedtext">{t("notAvailableBody")}</p>
          </div>
        </ProjectUnavailable>
      </div>
    );
  }

  const statuses: Record<string, ItemStatus> = {};
  for (const item of items) {
    statuses[item.id] = deriveItemStatus({ item, cartRows, orderLines });
  }

  return (
    <div className="space-y-6">
      <nav
        aria-label={t("breadcrumbLabel")}
        className="flex flex-wrap items-center gap-1.5 text-xs text-mutedtext"
      >
        <Link href="/projects" className="hover:text-heading">
          {t("navProjects")}
        </Link>
        <ChevronRight className={cn("h-3.5 w-3.5", isRtl && "rotate-180")} aria-hidden />
        <span aria-current="page" className="min-w-0 truncate text-heading">
          {project.name}
        </span>
      </nav>

      {partialError && (
        <p role="alert" className="rounded-xl bg-panel px-4 py-3 text-sm text-destructive shadow-neu-inset">
          {t("loadFailed")}
        </p>
      )}

      <ProjectHeader
        project={project}
        guest={guest}
        guestPhone={guestPhone}
        onRenamed={(name) => setProject((p) => (p ? { ...p, name } : p))}
      />
      <PrototypingCard projectId={projectId} bom={project.bom?.lines ? project.bom : null} />
      <BriefCard project={project} />
      <BlocksCard
        projectId={projectId}
        blocks={blocks}
        imageUrls={imageUrls}
        onChanged={load}
      />
      <ProjectCadCard projectId={projectId} />
      <ItemsCard projectId={projectId} items={items} statuses={statuses} onChanged={load} />
      <DangerZoneCard
        project={project}
        // Own-shelf units only (bought units are not "returned"), the same
        // count delete_project (0035) puts back.
        reclaimable={items.reduce((n, i) => n + (statuses[i.id]?.shelfQty ?? 0), 0)}
        onDeleted={() => router.push("/projects")}
      />
    </div>
  );
}

// ── Header ──────────────────────────────────────────────────────────────────

function ProjectHeader({
  project,
  guest,
  guestPhone,
  onRenamed,
}: {
  project: Project;
  guest: boolean;
  guestPhone: string | null;
  onRenamed: (name: string) => void;
}) {
  const t = useTranslations("Projects");
  const [name, setName] = useState(project.name);
  const [error, setError] = useState(false);

  async function saveName(next: string) {
    const trimmed = next.trim();
    if (!trimmed || trimmed === project.name) return;
    const { error: err } = await createClient()
      .from("projects")
      .update({ name: trimmed })
      .eq("id", project.id);
    setError(!!err);
    if (!err) onRenamed(trimmed);
  }

  return (
    <div className="neu space-y-4 p-6 sm:p-8">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={(e) => saveName(e.target.value)}
        aria-label={t("nameLabel")}
        className="w-full min-w-0 rounded-lg bg-transparent text-2xl font-extrabold tracking-tight text-heading outline-none focus:bg-panel focus:px-3 focus:py-1 focus:shadow-neu-inset sm:text-3xl"
      />
      {error && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {t("saveFailed")}
        </p>
      )}

      {guest && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-inventory-bg px-4 py-3">
          <Tag variant="inventory">{t("guestBadge")}</Tag>
          <p className="min-w-0 basis-full text-sm text-heading sm:flex-1 sm:basis-auto">
            {guestPhone ? t("guestPhoneNote", { phone: guestPhone }) : t("guestNote")}
          </p>
          <Link
            href="/sign-up"
            className="shrink-0 text-sm font-semibold text-cobalt hover:text-cobalt-hover"
          >
            {t("signUpCta")}
          </Link>
        </div>
      )}
    </div>
  );
}

// ── Prototyping entry ───────────────────────────────────────────────────────
// The assisted route from a brief to a part breakdown and 2D schematics. It
// is a separate workspace (app/[locale]/projects/[id]/prototyping) rather than
// part of this page: different job, different shape, and this page has to keep
// working on its own.

function PrototypingCard({ projectId, bom }: { projectId: string; bom: ProjectBom | null }) {
  const t = useTranslations("Prototyping");
  const locale = useLocale();
  const lines = activeLines(bom);
  // The same store matches the workspace reads (/api/bom/match) feed the same
  // toBuyNow(), so this page and the workspace never show two different totals
  // (audit "project page QAR total ≠ BOM To buy now").
  const [matches, setMatches] = useState<Map<string, LineMatch>>(new Map());
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const hasLines = lines.length > 0;

  useEffect(() => {
    if (!hasLines) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/bom/match", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ projectId }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const { matches: list } = (await res.json()) as { matches: LineMatch[] };
        if (cancelled) return;
        setMatches(new Map(list.map((m) => [m.lineId, m])));
        setLoaded(true);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, hasLines]);

  const state = costState({ lineCount: lines.length, matchesLoaded: loaded, matchFailed: failed });

  return (
    <section className="neu space-y-4 p-6 sm:p-8">
      <div className="flex flex-wrap items-center gap-4">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-surface shadow-neu-sm">
          <Sparkles className="h-5 w-5 text-cobalt" strokeWidth={1.5} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-heading">{t("kicker")}</h2>
          <p className="mt-1 text-sm text-mutedtext">{t("openIntro")}</p>
        </div>
        <Button asChild>
          <Link href={`/projects/${projectId}/prototyping`}>{t("open")}</Link>
        </Button>
      </div>
      {hasLines && (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-xl bg-panel/60 px-4 py-3 shadow-neu-inset">
          <p className="text-[10px] uppercase tracking-wider text-faint">{t("costToBuyNow")}</p>
          {state === "loading" ? (
            <>
              <span className="sr-only">{t("costLoading")}</span>
              <Skeleton className="h-4 w-24" />
            </>
          ) : state === "failed" ? (
            <p className="text-xs text-mutedtext">{t("costUnavailable")}</p>
          ) : (
            <p className="font-mono text-sm font-bold tabular-nums text-heading">{formatPrice(toBuyNow(bom, matches), locale)}</p>
          )}
          <p className="text-[11px] text-mutedtext">{t("projectToBuyNote")}</p>
        </div>
      )}
    </section>
  );
}

/** The project page while it loads: the page's own shape in grey bars, not a bare spinner (audit #59). */
function ProjectSkeleton({ label }: { label: string }) {
  return (
    <div className="space-y-6" role="status" aria-busy="true">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-3 w-40" />
      <div className="neu space-y-3 p-6 shadow-neu-inset sm:p-8">
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-3 w-1/3" />
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="neu space-y-3 p-6 sm:p-8">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-4/5" />
        </div>
      ))}
    </div>
  );
}

// ── Brief ───────────────────────────────────────────────────────────────────
// One brief per project (audit #19): this edits projects.brief, the same field
// the prototyping Brief stage reads and writes. projects.notes is no longer
// shown (0033 copies notes into an empty brief).

function BriefCard({ project }: { project: Project }) {
  const t = useTranslations("Projects");
  const [brief, setBrief] = useState(project.brief ?? "");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  // Grow with the text instead of scrolling inside a fixed box.
  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [brief]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  function onChange(value: string) {
    setBrief(value);
    setStatus("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const { error } = await createClient()
        .from("projects")
        .update({ brief: value.trim() ? value : null })
        .eq("id", project.id);
      setStatus(error ? "error" : "saved");
    }, 700);
  }

  return (
    <section className="neu space-y-3 p-6 sm:p-8">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-heading">
          <label htmlFor="project-brief">{t("briefHeading")}</label>
        </h2>
        {status !== "idle" && (
          <span
            role={status === "error" ? "alert" : undefined}
            className={cn(
              "text-[11px]",
              status === "error" ? "font-medium text-destructive" : "text-mutedtext"
            )}
          >
            {status === "saving" ? t("saving") : status === "saved" ? t("saved") : t("saveFailed")}
          </span>
        )}
      </div>
      <p className="text-sm text-mutedtext">{t("briefHint")}</p>
      <textarea
        id="project-brief"
        ref={areaRef}
        value={brief}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        placeholder={t("briefPlaceholder")}
        className="min-h-[7rem] w-full resize-none overflow-hidden rounded-xl border border-white/60 bg-panel px-4 py-3 text-sm leading-relaxed text-heading shadow-neu-inset outline-none placeholder:text-faint focus:ring-2 focus:ring-cobalt/60"
      />
    </section>
  );
}

// ── Blocks ──────────────────────────────────────────────────────────────────

function BlocksCard({
  projectId,
  blocks,
  imageUrls,
  onChanged,
}: {
  projectId: string;
  blocks: ProjectBlock[];
  imageUrls: Record<string, string>;
  onChanged: () => Promise<void>;
}) {
  const t = useTranslations("Projects");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const nextPosition = blocks.length ? Math.max(...blocks.map((b) => b.position)) + 1 : 0;

  async function addText() {
    setBusy(true);
    await createClient()
      .from("project_blocks")
      .insert({ project_id: projectId, type: "text", content: "", position: nextPosition });
    await onChanged();
    setBusy(false);
  }

  async function addImage(file: File) {
    setError(null);
    if (file.size > MAX_PROJECT_IMAGE_BYTES) {
      setError(t("imageTooLarge"));
      return;
    }
    setBusy(true);
    try {
      const user = await ensureSession();
      const supabase = createClient();
      const ext = file.name.split(".").pop() ?? "png";
      const path = `${user.id}/${projectId}/${crypto.randomUUID()}.${ext}`;

      const { error: upErr } = await supabase.storage
        .from(PROJECT_IMAGE_BUCKET)
        .upload(path, file);
      if (upErr) throw upErr;

      await supabase
        .from("project_blocks")
        .insert({ project_id: projectId, type: "image", storage_path: path, position: nextPosition });
      await onChanged();
    } catch {
      setError(t("uploadFailed"));
    }
    setBusy(false);
  }

  async function saveText(id: string, content: string) {
    await createClient().from("project_blocks").update({ content }).eq("id", id);
  }

  async function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= blocks.length) return;
    const a = blocks[index];
    const b = blocks[target];
    setBusy(true);
    const supabase = createClient();
    await Promise.all([
      supabase.from("project_blocks").update({ position: b.position }).eq("id", a.id),
      supabase.from("project_blocks").update({ position: a.position }).eq("id", b.id),
    ]);
    await onChanged();
    setBusy(false);
  }

  async function remove(block: ProjectBlock) {
    setBusy(true);
    const supabase = createClient();
    if (block.storage_path) {
      await supabase.storage.from(PROJECT_IMAGE_BUCKET).remove([block.storage_path]);
    }
    await supabase.from("project_blocks").delete().eq("id", block.id);
    await onChanged();
    setBusy(false);
  }

  return (
    <section className="neu space-y-4 p-6 sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-heading">{t("blocksHeading")}</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={addText}
            disabled={busy}
            className="inline-flex items-center rounded-lg bg-panel px-3 py-1.5 text-xs font-semibold text-heading shadow-neu-sm transition-colors hover:text-cobalt disabled:opacity-60"
          >
            <TypeIcon className="me-1.5 h-3.5 w-3.5" />
            {t("addText")}
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="inline-flex items-center rounded-lg bg-panel px-3 py-1.5 text-xs font-semibold text-heading shadow-neu-sm transition-colors hover:text-cobalt disabled:opacity-60"
          >
            <ImagePlus className="me-1.5 h-3.5 w-3.5" />
            {t("addImage")}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept={PROJECT_IMAGE_ACCEPT}
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void addImage(f);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      {error && <p className="text-sm font-medium text-destructive">{error}</p>}

      {blocks.length === 0 ? (
        <p className="text-sm text-mutedtext">{t("emptyBlocks")}</p>
      ) : (
        <ul className="space-y-3">
          {blocks.map((block, i) => (
            <li key={block.id} className="rounded-xl bg-panel p-3 shadow-neu-sm">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  {block.type === "text" ? (
                    <textarea
                      defaultValue={block.content ?? ""}
                      onBlur={(e) => saveText(block.id, e.target.value)}
                      rows={3}
                      placeholder={t("blockPlaceholder")}
                      className="w-full resize-y rounded-lg bg-transparent text-sm leading-relaxed text-heading outline-none placeholder:text-faint"
                    />
                  ) : block.storage_path && imageUrls[block.storage_path] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={imageUrls[block.storage_path]}
                      alt=""
                      className="max-h-80 w-auto rounded-lg"
                    />
                  ) : (
                    <p className="text-sm text-mutedtext">{t("uploading")}</p>
                  )}
                </div>

                <div className="flex shrink-0 flex-col gap-1">
                  <IconBtn label={t("moveUp")} onClick={() => move(i, -1)} disabled={busy || i === 0}>
                    <ChevronUp className="h-3.5 w-3.5" />
                  </IconBtn>
                  <IconBtn
                    label={t("moveDown")}
                    onClick={() => move(i, 1)}
                    disabled={busy || i === blocks.length - 1}
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </IconBtn>
                  <IconBtn label={t("remove")} onClick={() => remove(block)} disabled={busy} danger>
                    <Trash2 className="h-3.5 w-3.5" />
                  </IconBtn>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function IconBtn({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        "rounded-md p-1.5 text-mutedtext transition-colors disabled:opacity-30",
        danger ? "hover:text-destructive" : "hover:text-cobalt"
      )}
    >
      {children}
    </button>
  );
}

// ── Items ───────────────────────────────────────────────────────────────────

function ItemsCard({
  projectId,
  items,
  statuses,
  onChanged,
}: {
  projectId: string;
  items: ItemWithPart[];
  statuses: Record<string, ItemStatus>;
  onChanged: () => Promise<void>;
}) {
  const t = useTranslations("Projects");
  const locale = useLocale();
  const [addingKey, setAddingKey] = useState<string | null>(null);
  const [addedKey, setAddedKey] = useState<string | null>(null);
  // Which way the last add went, so we can say so plainly.
  const [lastMove, setLastMove] = useState<"inventory" | "cart" | null>(null);
  // Bumped after every allocation so the search re-reads the inventory it
  // just changed. items.length would miss a quantity-only move.
  const [version, setVersion] = useState(0);

  // A part is either on their shelf or on this project, never both. So take
  // whatever they already own off the inventory, and only buy the shortfall.
  async function add(hit: SearchHit) {
    if (!hit.part) return;
    setAddingKey(hit.key);
    try {
      const user = await ensureSession();
      const supabase = createClient();
      const part = hit.part;

      const { fromInventory, toCart } = splitOnAdd(1, hit.owned);

      const { data: existing } = await supabase
        .from("project_items")
        .select("id, quantity, qty_from_inventory")
        .eq("project_id", projectId)
        .eq("product_id", part.id)
        .maybeSingle();

      if (existing) {
        await supabase
          .from("project_items")
          .update({
            quantity: existing.quantity + 1,
            qty_from_inventory: existing.qty_from_inventory + fromInventory,
          })
          .eq("id", existing.id);
      } else {
        await supabase.from("project_items").insert({
          project_id: projectId,
          product_id: part.id,
          quantity: 1,
          qty_from_inventory: fromInventory,
        });
      }

      await takeFromInventory(supabase, user.id, part.id, fromInventory);
      await adjustCart(supabase, user.id, part.id, projectId, toCart);

      setLastMove(fromInventory > 0 ? "inventory" : "cart");
      setVersion((v) => v + 1);
      await onChanged();
      setAddedKey(hit.key);
      setTimeout(() => setAddedKey(null), 1600);
    } finally {
      setAddingKey(null);
    }
  }

  async function setQuantity(item: ItemWithPart, quantity: number) {
    const user = await ensureSession();
    const supabase = createClient();
    const target = Math.max(0, quantity);
    const delta = target - item.quantity;
    if (delta === 0) return;

    if (delta > 0) {
      // Growing the line: shelf first, then the cart, same as adding.
      const owned = await ownedCount(supabase, user.id, item.product_id);
      const { fromInventory, toCart } = splitOnAdd(delta, owned);
      await supabase
        .from("project_items")
        .update({
          quantity: target,
          qty_from_inventory: item.qty_from_inventory + fromInventory,
        })
        .eq("id", item.id);
      await takeFromInventory(supabase, user.id, item.product_id, fromInventory);
      await adjustCart(supabase, user.id, item.product_id, projectId, toCart);
    } else {
      // Shrinking: release cart units first — those were never theirs — and
      // only then hand shelf units back.
      const drop = -delta;
      const { toCart, fromInventory } = splitOnRemove(
        drop,
        item.qty_from_inventory,
        item.quantity
      );
      await adjustCart(supabase, user.id, item.product_id, projectId, -toCart);
      await returnToInventory(supabase, user.id, item.product_id, fromInventory);

      if (target === 0) {
        await supabase.from("project_items").delete().eq("id", item.id);
      } else {
        await supabase
          .from("project_items")
          .update({
            quantity: target,
            qty_from_inventory: item.qty_from_inventory - fromInventory,
          })
          .eq("id", item.id);
      }
    }

    setVersion((v) => v + 1);
    await onChanged();
  }

  const total = items.reduce(
    (sum, i) => sum + (i.part ? i.part.unit_price * i.quantity : 0),
    0
  );

  return (
    <section className="neu space-y-4 p-6 sm:p-8">
      <div>
        <h2 className="text-sm font-semibold text-heading">{t("itemsHeading")}</h2>
        <p className="mt-1 text-sm text-mutedtext">{t("itemsIntroStatus")}</p>
      </div>

      <UnifiedSearch
        onAdd={add}
        addingKey={addingKey}
        addedKey={addedKey}
        reloadKey={version}
      />

      {lastMove && (
        <p className="text-sm text-buy">
          {lastMove === "inventory" ? t("tookFromInventory") : t("addedToCart")}
        </p>
      )}

      {items.length === 0 ? (
        <p className="pt-1 text-sm text-mutedtext">{t("emptyProject")}</p>
      ) : (
        <>
          <ul className="space-y-2">
            {items.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-panel px-3 py-2.5 shadow-neu-sm"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-heading">
                    {item.part ? partName(item.part, locale) : "—"}
                  </span>
                  {item.part && (
                    <span className="block truncate font-mono text-[11px] text-mutedtext">
                      {item.part.sku}
                    </span>
                  )}
                </span>

                {statuses[item.id] && (
                  <ItemStatusTags status={statuses[item.id]} />
                )}

                <input
                  type="number"
                  min={0}
                  value={item.quantity}
                  aria-label={t("quantity")}
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10);
                    if (Number.isFinite(n)) void setQuantity(item, n);
                  }}
                  className="w-16 rounded-lg border border-white/60 bg-surface px-2 py-1 text-center text-sm text-heading shadow-neu-inset outline-none focus:ring-2 focus:ring-cobalt/60"
                />

                {item.part && (
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-heading">
                    {formatPrice(item.part.unit_price * item.quantity, locale)}
                  </span>
                )}

                <button
                  type="button"
                  onClick={() => setQuantity(item, 0)}
                  aria-label={t("removeItem")}
                  className="shrink-0 rounded-md p-1.5 text-mutedtext transition-colors hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>

          <div className="flex items-center justify-between border-t border-borderstrong/40 pt-3">
            <span className="text-sm text-mutedtext">{t("itemsTotal")}</span>
            <span className="text-base font-bold tabular-nums text-heading">
              {formatPrice(total, locale)}
            </span>
          </div>
        </>
      )}
    </section>
  );
}

// Where each line actually is (audit #3): ordered / delivered / in cart / to
// buy, plus any units that came off the client's own shelf.
function ItemStatusTags({ status }: { status: ItemStatus }) {
  const t = useTranslations("Projects");
  const tOrders = useTranslations("PartsDashboard");

  const orderStatusLabel = (s: string | undefined) => {
    if (!s) return "";
    const key = `order_status_${s}`;
    return tOrders.has(key) ? tOrders(key) : s;
  };

  return (
    <>
      {status.shelfQty > 0 && (
        <Tag variant="inventory">{t("yoursCount", { count: status.shelfQty })}</Tag>
      )}
      {status.kind === "ordered" && status.shortId && (
        <Tag variant="neutral">
          {t("itemOrdered", { id: status.shortId, status: orderStatusLabel(status.orderStatus) })}
        </Tag>
      )}
      {status.kind === "delivered" && (
        <Tag variant="inventory">{orderStatusLabel("delivered")}</Tag>
      )}
      {status.cartQty > 0 && (
        <Tag variant="buy">{t("itemInCart", { count: status.cartQty })}</Tag>
      )}
      {/* Whatever the kind: a part-delivered line can still be short. */}
      {status.missingQty > 0 && (
        <Tag variant="buy">{t("toBuyCount", { count: status.missingQty })}</Tag>
      )}
    </>
  );
}

// ── Danger zone ─────────────────────────────────────────────────────────────
// Deleting sits at the bottom, away from the title (audit #18).

function DangerZoneCard({
  project,
  reclaimable,
  onDeleted,
}: {
  project: Project;
  /** Units on this project that came off the client's own shelf. */
  reclaimable: number;
  onDeleted: () => void;
}) {
  const t = useTranslations("Projects");
  const [deleting, setDeleting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(false);

  // Cancelling a project frees whatever it was holding. Anything that came off
  // their own shelf can go back there — but that is their call, so we ask
  // rather than assume. The cart lines are released either way, because the
  // project that justified them no longer exists.
  //
  // One RPC = one transaction (0035): the ownership check, the put-back, the
  // cart clean-up and the delete all happen or none do, so "nothing was
  // changed" on failure is true.
  async function remove(putBack: boolean) {
    setDeleting(true);
    setError(false);
    const { error: rpcErr } = await createClient().rpc("delete_project", {
      p_id: project.id,
      p_put_back: putBack,
    });
    if (rpcErr) {
      setError(true);
      setDeleting(false);
      return;
    }
    onDeleted();
  }

  return (
    <section
      aria-labelledby="project-danger-zone"
      className="neu space-y-4 border border-destructive/20 p-6 sm:p-8"
    >
      <div>
        <h2 id="project-danger-zone" className="text-sm font-semibold text-destructive">
          {t("dangerZone")}
        </h2>
        <p className="mt-1 text-sm text-mutedtext">{t("deleteHint")}</p>
      </div>

      {!confirming && (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          disabled={deleting}
          className="rounded-lg bg-surface px-3.5 py-2 text-xs font-semibold text-destructive shadow-neu-sm transition-colors disabled:opacity-60"
        >
          {t("deleteProject")}
        </button>
      )}

      {confirming && (
        <div className="space-y-3 rounded-xl bg-panel p-4 shadow-neu-inset">
          <p className="text-sm text-heading">
            {reclaimable > 0
              ? t("cancelWithParts", { count: reclaimable })
              : t("deleteConfirm")}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {reclaimable > 0 && (
              <button
                type="button"
                onClick={() => remove(true)}
                disabled={deleting}
                className="rounded-lg bg-cobalt px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-cobalt-hover disabled:opacity-60"
              >
                {t("returnParts")}
              </button>
            )}
            <button
              type="button"
              onClick={() => remove(false)}
              disabled={deleting}
              className="rounded-lg bg-surface px-3.5 py-2 text-xs font-semibold text-destructive shadow-neu-sm transition-colors disabled:opacity-60"
            >
              {reclaimable > 0 ? t("discardParts") : t("deleteProject")}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={deleting}
              className="rounded-lg px-3.5 py-2 text-xs font-semibold text-mutedtext transition-colors hover:text-heading"
            >
              {t("keepProject")}
            </button>
            {deleting && <Loader2 className="h-4 w-4 animate-spin text-mutedtext" />}
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {t("deleteFailed")}
        </p>
      )}
    </section>
  );
}
