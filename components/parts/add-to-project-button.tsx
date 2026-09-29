"use client";

// "Add to project" on a product page (audit #16). Lists the visitor's own
// projects (RLS: owns_project), adds the product to the chosen one — or bumps
// its quantity if it's already there — and links to that project. A visitor
// with no projects yet can start one here; the product is added to it.

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, FolderPlus, Loader2 } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import { ensureSession } from "@/lib/supabase/guest";
import { Button } from "@/components/ui/button";

type Project = { id: string; name: string };

export function AddToProjectButton({ partId, partName }: { partId: string; partName: string }) {
  const t = useTranslations("Parts");
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState<Project | null>(null);
  const [error, setError] = useState(false);
  const [newName, setNewName] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || projects) return;
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return setProjects([]);
      const { data: rows } = await supabase
        .from("projects")
        .select("id, name")
        .eq("user_id", data.user.id)
        .order("updated_at", { ascending: false })
        .limit(20);
      setProjects((rows ?? []) as Project[]);
    });
  }, [open, projects]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  async function addTo(project: Project) {
    setBusy(true);
    setError(false);
    const supabase = createClient();
    const { data: existing } = await supabase
      .from("project_items")
      .select("id, quantity")
      .eq("project_id", project.id)
      .eq("product_id", partId)
      .maybeSingle();
    const { error: err } = existing
      ? await supabase.from("project_items").update({ quantity: (existing.quantity as number) + 1 }).eq("id", existing.id)
      : await supabase.from("project_items").insert({ project_id: project.id, product_id: partId, quantity: 1 });
    setBusy(false);
    if (err) return setError(true);
    setAdded(project);
    setOpen(false);
  }

  async function createAndAdd() {
    const name = newName.trim() || partName;
    setBusy(true);
    setError(false);
    try {
      const user = await ensureSession();
      const { data, error: err } = await createClient()
        .from("projects")
        .insert({ user_id: user.id, name: name.slice(0, 120) })
        .select("id, name")
        .single();
      if (err) throw err;
      setBusy(false);
      await addTo(data as Project);
    } catch {
      setBusy(false);
      setError(true);
    }
  }

  if (added) {
    return (
      <span className="inline-flex items-center gap-2 text-sm font-medium text-emerald-700">
        <Check className="h-4 w-4" />
        {t("addedToProject")}{" "}
        <Link href={`/projects/${added.id}`} className="font-semibold text-cobalt hover:underline">
          {added.name}
        </Link>
      </span>
    );
  }

  return (
    <div className="relative" ref={boxRef}>
      <Button type="button" variant="outline" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="rounded-full">
        <FolderPlus className="h-4 w-4" />
        {t("addToProject")}
      </Button>
      {open && (
        <div className="neu absolute start-0 top-full z-30 mt-2 w-72 space-y-1 p-2">
          {projects === null ? (
            <p className="flex items-center gap-2 px-3 py-2 text-sm text-mutedtext">
              <Loader2 className="h-4 w-4 animate-spin" />
            </p>
          ) : (
            projects.map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={busy}
                onClick={() => addTo(p)}
                className="block w-full truncate rounded-lg px-3 py-2 text-start text-sm text-heading hover:bg-panel disabled:opacity-60"
              >
                {p.name}
              </button>
            ))
          )}
          <div className="space-y-2 border-t border-borderstrong/40 px-1 pt-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t("newProjectFor", { name: partName.slice(0, 40) })}
              aria-label={t("newProjectName")}
              className="w-full rounded-lg border border-white/60 bg-panel px-3 py-2 text-sm text-heading shadow-neu-inset outline-none placeholder:text-faint"
            />
            <Button type="button" size="sm" disabled={busy} onClick={createAndAdd} className="w-full rounded-lg">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t("startProjectWithPart")}
            </Button>
          </div>
          {error && <p className="px-3 py-1 text-xs font-medium text-destructive">{t("addToProjectFailed")}</p>}
        </div>
      )}
    </div>
  );
}
