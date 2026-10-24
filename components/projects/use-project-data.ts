"use client";

// Project page data, split out of project-workspace.tsx (R8).
// The project workspace. Everything reads and writes through the browser
// client so a guest and a signed-in client behave identically — RLS scopes both
// to their own auth.uid(). On top of RLS the project is read with
// user_id = the signed-in user: a super_admin's RLS read of everyone's
// projects belongs to /dashboard/projects, not here (decision 6a).

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getCurrentUser, isGuest } from "@/lib/supabase/guest";
import { PROJECT_IMAGE_BUCKET } from "@/lib/projects/constants";
import type { StatusCartRow, StatusOrderLine } from "@/lib/projects/item-status";
import { activeLines, type LineMatch, type ProjectBom } from "@/lib/prototyping/bom";
import { costState, type CostState } from "@/lib/prototyping/bom-cost";
import type { Part, Project, ProjectBlock, ProjectItem } from "@/lib/supabase/types";
import { PART_PUBLIC_COLUMNS } from "@/lib/store/part-columns";

export type ItemWithPart = ProjectItem & { part: Part | null };

type OrderLineRow = {
  part_id: string;
  quantity: number;
  order: StatusOrderLine["order"] | StatusOrderLine["order"][];
};

/**
 * The live store matches for a project's bill of materials (/api/bom/match),
 * read once for the page: the parts list and the prototyping card both use
 * them, the same matches the workspace reads.
 */
function useBomMatches(projectId: string, bom: ProjectBom | null): { matches: Map<string, LineMatch>; state: CostState } {
  const [matches, setMatches] = useState<Map<string, LineMatch>>(new Map());
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const lineCount = activeLines(bom).length;
  const hasLines = lineCount > 0;

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

  return { matches, state: costState({ lineCount, matchesLoaded: loaded, matchFailed: failed }) };
}

/** Everything the project page reads, loaded through the browser client (RLS-scoped). */
export function useProjectData(projectId: string) {
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
  const bom = project?.bom?.lines ? (project.bom as ProjectBom) : null;
  const bomMatches = useBomMatches(projectId, bom);

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
        .select(`*, part:parts(${PART_PUBLIC_COLUMNS})`)
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

  return {
    project,
    setProject,
    blocks,
    items,
    cartRows,
    orderLines,
    imageUrls,
    guest,
    guestPhone,
    signedIn,
    loading,
    notFound,
    fatalError,
    partialError,
    bom,
    bomMatches,
    load,
  };
}
