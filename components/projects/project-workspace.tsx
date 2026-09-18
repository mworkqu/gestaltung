"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  ChevronDown,
  ChevronUp,
  ImagePlus,
  Loader2,
  Trash2,
  Type as TypeIcon,
} from "lucide-react";

import { Link, useRouter } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import { ensureSession, isGuest } from "@/lib/supabase/guest";
import { formatPrice, partName } from "@/lib/parts/format";
import {
  MAX_PROJECT_IMAGE_BYTES,
  PROJECT_IMAGE_ACCEPT,
  PROJECT_IMAGE_BUCKET,
  PROJECT_MATERIALS,
} from "@/lib/projects/constants";
import { UnifiedSearch, type SearchHit } from "@/components/search/unified-search";
import { Tag } from "@/components/ui/tag";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  Part,
  Project,
  ProjectBlock,
  ProjectItem,
  ProjectMaterial,
} from "@/lib/supabase/types";

// The project workspace. Everything reads and writes through the browser
// client so a guest and a signed-in client behave identically — RLS scopes both
// to their own auth.uid().

type ItemWithPart = ProjectItem & { part: Part | null };

export function ProjectWorkspace({ projectId }: { projectId: string }) {
  const t = useTranslations("Projects");
  const router = useRouter();

  const [project, setProject] = useState<Project | null>(null);
  const [blocks, setBlocks] = useState<ProjectBlock[]>([]);
  const [materials, setMaterials] = useState<ProjectMaterial[]>([]);
  const [items, setItems] = useState<ItemWithPart[]>([]);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [guest, setGuest] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    setGuest(isGuest(user));

    const { data: proj } = await supabase
      .from("projects")
      .select("*")
      .eq("id", projectId)
      .maybeSingle();

    if (!proj) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    setProject(proj as Project);

    const [blockRes, matRes, itemRes] = await Promise.all([
      supabase
        .from("project_blocks")
        .select("*")
        .eq("project_id", projectId)
        .order("position", { ascending: true }),
      supabase.from("project_materials").select("*").eq("project_id", projectId),
      supabase
        .from("project_items")
        .select("*, part:parts(*)")
        .eq("project_id", projectId)
        .order("created_at", { ascending: true }),
    ]);

    const loadedBlocks = (blockRes.data ?? []) as ProjectBlock[];
    setBlocks(loadedBlocks);
    setMaterials((matRes.data ?? []) as ProjectMaterial[]);
    setItems((itemRes.data ?? []) as ItemWithPart[]);

    // The bucket is private, so every image needs a short-lived signed URL.
    const paths = loadedBlocks
      .filter((b) => b.type === "image" && b.storage_path)
      .map((b) => b.storage_path as string);
    if (paths.length) {
      const { data: signed } = await supabase.storage
        .from(PROJECT_IMAGE_BUCKET)
        .createSignedUrls(paths, 3600);
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

  if (loading) {
    return (
      <div className="neu flex items-center justify-center p-16">
        <Loader2 className="h-5 w-5 animate-spin text-mutedtext" />
      </div>
    );
  }

  if (notFound || !project) {
    return (
      <div className="neu p-10 text-center">
        <p className="text-base text-mutedtext">{t("emptyList")}</p>
        <Button asChild className="mt-5">
          <Link href="/projects">{t("listHeading")}</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ProjectHeader project={project} guest={guest} onDeleted={() => router.push("/projects")} />
      <NotesCard project={project} />
      <BlocksCard
        projectId={projectId}
        blocks={blocks}
        imageUrls={imageUrls}
        onChanged={load}
      />
      <MaterialsCard projectId={projectId} materials={materials} onChanged={load} />
      <ItemsCard projectId={projectId} items={items} onChanged={load} />
    </div>
  );
}

// ── Header ──────────────────────────────────────────────────────────────────

function ProjectHeader({
  project,
  guest,
  onDeleted,
}: {
  project: Project;
  guest: boolean;
  onDeleted: () => void;
}) {
  const t = useTranslations("Projects");
  const [name, setName] = useState(project.name);
  const [deleting, setDeleting] = useState(false);

  async function saveName(next: string) {
    const trimmed = next.trim();
    if (!trimmed || trimmed === project.name) return;
    await createClient().from("projects").update({ name: trimmed }).eq("id", project.id);
  }

  async function remove() {
    if (!window.confirm(t("deleteConfirm"))) return;
    setDeleting(true);
    await createClient().from("projects").delete().eq("id", project.id);
    onDeleted();
  }

  return (
    <div className="neu space-y-4 p-6 sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={(e) => saveName(e.target.value)}
          aria-label={t("nameLabel")}
          className="min-w-0 flex-1 rounded-lg bg-transparent text-2xl font-extrabold tracking-tight text-heading outline-none focus:bg-panel focus:px-3 focus:py-1 focus:shadow-neu-inset sm:text-3xl"
        />
        <button
          type="button"
          onClick={remove}
          disabled={deleting}
          className="shrink-0 rounded-lg px-3 py-2 text-xs font-semibold text-mutedtext transition-colors hover:text-destructive"
        >
          {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : t("deleteProject")}
        </button>
      </div>

      {guest && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-inventory-bg px-4 py-3">
          <Tag variant="inventory">{t("guestBadge")}</Tag>
          <p className="min-w-0 basis-full text-sm text-heading sm:flex-1 sm:basis-auto">
            {t("guestNote")}
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

// ── Notes ───────────────────────────────────────────────────────────────────

function NotesCard({ project }: { project: Project }) {
  const t = useTranslations("Projects");
  const [notes, setNotes] = useState(project.notes ?? "");
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function onChange(value: string) {
    setNotes(value);
    setStatus("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      await createClient().from("projects").update({ notes: value }).eq("id", project.id);
      setStatus("saved");
    }, 700);
  }

  return (
    <section className="neu space-y-3 p-6 sm:p-8">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-heading">{t("notesHeading")}</h2>
        {status !== "idle" && (
          <span className="text-[11px] text-mutedtext">
            {status === "saving" ? t("saving") : t("saved")}
          </span>
        )}
      </div>
      <textarea
        value={notes}
        onChange={(e) => onChange(e.target.value)}
        rows={6}
        placeholder={t("notesPlaceholder")}
        className="w-full resize-y rounded-xl border border-white/60 bg-panel px-4 py-3 text-sm leading-relaxed text-heading shadow-neu-inset outline-none placeholder:text-faint focus:ring-2 focus:ring-cobalt/60"
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

// ── Materials ───────────────────────────────────────────────────────────────

function MaterialsCard({
  projectId,
  materials,
  onChanged,
}: {
  projectId: string;
  materials: ProjectMaterial[];
  onChanged: () => Promise<void>;
}) {
  const t = useTranslations("Projects");
  const [busy, setBusy] = useState(false);
  const chosen = new Set(materials.map((m) => m.material));

  async function toggle(key: string) {
    setBusy(true);
    const supabase = createClient();
    if (chosen.has(key)) {
      await supabase
        .from("project_materials")
        .delete()
        .eq("project_id", projectId)
        .eq("material", key);
    } else {
      await supabase.from("project_materials").insert({ project_id: projectId, material: key });
    }
    await onChanged();
    setBusy(false);
  }

  return (
    <section className="neu space-y-3 p-6 sm:p-8">
      <h2 className="text-sm font-semibold text-heading">{t("materialsHeading")}</h2>
      <p className="text-sm text-mutedtext">{t("materialsIntro")}</p>
      <div className="flex flex-wrap gap-2 pt-1">
        {PROJECT_MATERIALS.map((key) => {
          const on = chosen.has(key);
          return (
            <button
              key={key}
              type="button"
              onClick={() => toggle(key)}
              disabled={busy}
              aria-pressed={on}
              className={cn(
                "rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-60",
                on
                  ? "bg-cobalt text-white shadow-neu-sm"
                  : "bg-panel text-mutedtext shadow-neu-sm hover:text-heading"
              )}
            >
              {t(`material_${key}`)}
            </button>
          );
        })}
      </div>
    </section>
  );
}

// ── Items ───────────────────────────────────────────────────────────────────

function ItemsCard({
  projectId,
  items,
  onChanged,
}: {
  projectId: string;
  items: ItemWithPart[];
  onChanged: () => Promise<void>;
}) {
  const t = useTranslations("Projects");
  const locale = useLocale();
  const [addingKey, setAddingKey] = useState<string | null>(null);
  const [addedKey, setAddedKey] = useState<string | null>(null);

  // Adding an item to a project ALSO puts it in the cart, tagged with this
  // project. No order is placed — checkout stays a separate, deliberate step.
  async function add(hit: SearchHit) {
    if (!hit.part) return;
    setAddingKey(hit.key);
    try {
      const user = await ensureSession();
      const supabase = createClient();
      const part = hit.part;

      const { data: existing } = await supabase
        .from("project_items")
        .select("id, quantity")
        .eq("project_id", projectId)
        .eq("product_id", part.id)
        .maybeSingle();

      if (existing) {
        await supabase
          .from("project_items")
          .update({ quantity: existing.quantity + 1 })
          .eq("id", existing.id);
      } else {
        await supabase
          .from("project_items")
          .insert({ project_id: projectId, product_id: part.id, quantity: 1 });
      }

      const { data: cartLine } = await supabase
        .from("cart_items")
        .select("id, quantity")
        .eq("user_id", user.id)
        .eq("product_id", part.id)
        .eq("project_id", projectId)
        .maybeSingle();

      if (cartLine) {
        await supabase
          .from("cart_items")
          .update({ quantity: cartLine.quantity + 1 })
          .eq("id", cartLine.id);
      } else {
        await supabase.from("cart_items").insert({
          user_id: user.id,
          product_id: part.id,
          project_id: projectId,
          quantity: 1,
        });
      }

      await onChanged();
      setAddedKey(hit.key);
      setTimeout(() => setAddedKey(null), 1200);
    } finally {
      setAddingKey(null);
    }
  }

  async function setQuantity(item: ItemWithPart, quantity: number) {
    const supabase = createClient();
    if (quantity <= 0) {
      await Promise.all([
        supabase.from("project_items").delete().eq("id", item.id),
        supabase
          .from("cart_items")
          .delete()
          .eq("project_id", projectId)
          .eq("product_id", item.product_id),
      ]);
    } else {
      await Promise.all([
        supabase.from("project_items").update({ quantity }).eq("id", item.id),
        supabase
          .from("cart_items")
          .update({ quantity })
          .eq("project_id", projectId)
          .eq("product_id", item.product_id),
      ]);
    }
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
        <p className="mt-1 text-sm text-mutedtext">{t("itemsIntro")}</p>
      </div>

      <UnifiedSearch onAdd={add} addingKey={addingKey} addedKey={addedKey} />

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
            <span className="text-sm text-mutedtext">{t("itemsHeading")}</span>
            <span className="text-base font-bold tabular-nums text-heading">
              {formatPrice(total, locale)}
            </span>
          </div>
        </>
      )}
    </section>
  );
}
