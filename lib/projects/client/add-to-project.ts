// The browser reads and writes behind "Add to project" on a product page
// (components/parts/add-to-project-button.tsx), moved out of the component
// unchanged (R11). RLS (owns_project) scopes every call to the caller.

import { createClient } from "@/lib/supabase/client";

export type ProjectChoice = { id: string; name: string };

/** The user's 20 most recently updated projects. */
export async function listRecentProjects(userId: string): Promise<ProjectChoice[]> {
  const { data: rows } = await createClient()
    .from("projects")
    .select("id, name")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(20);
  return (rows ?? []) as ProjectChoice[];
}

/** Add one of a product to a project, bumping the quantity if it is already there. The error, if any. */
export async function addProductToProject(projectId: string, productId: string): Promise<{ message?: string } | null> {
  const supabase = createClient();
  const { data: existing } = await supabase
    .from("project_items")
    .select("id, quantity")
    .eq("project_id", projectId)
    .eq("product_id", productId)
    .maybeSingle();
  const { error } = existing
    ? await supabase.from("project_items").update({ quantity: (existing.quantity as number) + 1 }).eq("id", existing.id)
    : await supabase.from("project_items").insert({ project_id: projectId, product_id: productId, quantity: 1 });
  return error;
}

/** Start a project (0042: a 4th active project is refused, the error says `project_limit`). Throws on error. */
export async function createProjectNamed(userId: string, name: string): Promise<ProjectChoice> {
  const { data, error } = await createClient()
    .from("projects")
    .insert({ user_id: userId, name: name.slice(0, 120) })
    .select("id, name")
    .single();
  if (error) throw error;
  return data as ProjectChoice;
}
