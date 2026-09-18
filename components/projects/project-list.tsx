"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Plus } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import type { Project } from "@/lib/supabase/types";

// Client-side on purpose: a first-time visitor has no session at all, and a
// guest's session cookie is written by the browser. Reading here means the list
// behaves identically for a guest and a signed-in client.
export function ProjectList() {
  const t = useTranslations("Projects");
  const [projects, setProjects] = useState<Project[] | null>(null);

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

      const { data } = await supabase
        .from("projects")
        .select("*")
        .order("updated_at", { ascending: false });

      if (!cancelled) setProjects((data ?? []) as Project[]);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

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
            className="neu neu-hover block h-full p-5 transition-shadow"
          >
            <p className="text-base font-semibold text-heading">{p.name}</p>
            {p.notes && (
              <p className="mt-2 line-clamp-2 text-sm text-mutedtext">{p.notes}</p>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}
