"use client";

// The known boards a project uses (ESP32, Uno, Pi…), read from its bill of
// materials, catalog parts and store lines, so partNeeds can check that an
// enclosure is big enough for what goes inside it (audit #5).
//
// Browser client + RLS: the project row is read only if it is the signed-in
// user's own; project_parts / project_items are scoped by owns_project(). A
// failed read is reported, never turned into "no boards".

import { useEffect, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import { projectBoards, type Footprint } from "@/lib/prototyping/footprints";
import type { ProjectBom } from "@/lib/prototyping/bom";

/** A refresh key for useProjectBoards: the same parts give the same string. */
export const partsKey = (parts: readonly { id: string; name: string }[]) =>
  parts.map((p) => `${p.id}:${p.name}`).join("|");

export function useProjectBoards(
  projectId: string,
  /**
   * A STABLE string that changes when the project's lines might have (see
   * partsKey): the hook re-reads only then, not on every render.
   */
  refreshKey: string
): { boards: Footprint[]; failed: boolean } {
  const [state, setState] = useState<{ boards: Footprint[]; failed: boolean }>({ boards: [], failed: false });

  useEffect(() => {
    let live = true;
    const read = async () => {
      const supabase = createClient();
      // The local session is enough to scope the read: RLS checks it again.
      const { data, error } = await supabase.auth.getSession();
      const user = data.session?.user;
      if (error || !user) {
        if (live) setState({ boards: [], failed: true });
        return;
      }
      const [project, parts, items] = await Promise.all([
        supabase.from("projects").select("bom").eq("id", projectId).eq("user_id", user.id).maybeSingle(),
        supabase.from("project_parts").select("name").eq("project_id", projectId),
        supabase.from("project_items").select("part:parts(name)").eq("project_id", projectId),
      ]);
      if (!live) return;
      if (project.error || parts.error || items.error) {
        setState({ boards: [], failed: true });
        return;
      }
      const bom = (project.data as { bom?: ProjectBom | null } | null)?.bom ?? null;
      const itemNames = ((items.data ?? []) as { part: { name: string } | { name: string }[] | null }[]).flatMap(
        (i) => (Array.isArray(i.part) ? i.part.map((x) => x.name) : i.part ? [i.part.name] : [])
      );
      setState({
        boards: projectBoards({
          bom,
          partNames: (parts.data ?? []).map((p: { name: string }) => p.name),
          itemNames,
        }),
        failed: false,
      });
    };
    // A network failure is a failed read too, not an empty project.
    read().catch(() => {
      if (live) setState({ boards: [], failed: true });
    });
    return () => {
      live = false;
    };
  }, [projectId, refreshKey]);

  return state;
}
