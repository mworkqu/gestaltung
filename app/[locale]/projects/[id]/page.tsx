import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { pageMetadata } from "@/lib/seo";

import { createClient } from "@/lib/supabase/server";
import { ProjectClaimGate } from "@/components/projects/project-claim-gate";
import { MessagesScope } from "@/components/i18n/messages-scope";

// Tab title = the project's name (audit #23). Read with the request's own
// session, scoped to the signed-in owner exactly like the workspace, so a
// foreign project's name never reaches the title. Anything else falls back to
// the generic Projects title.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<Metadata> {
  const { locale, id } = await params;
  const t = await getTranslations({ locale, namespace: "Projects" });
  // A private workspace: never indexed, whatever the title says.
  const fallback = pageMetadata({
    locale,
    path: "/projects",
    title: t("metaTitle"),
    description: t("metaDescription"),
    noindex: true,
  });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fallback;

  const { data } = await supabase
    .from("projects")
    .select("name, brief")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!data?.name) return fallback;

  const brief = typeof data.brief === "string" ? data.brief.replace(/\s+/g, " ").trim() : "";
  return pageMetadata({
    locale,
    path: "/projects",
    title: `${data.name} | Gestaltung360`,
    description: brief
      ? brief.length > 150
        ? `${brief.slice(0, 149).trimEnd()}…`
        : brief
      : (fallback.description ?? undefined),
    noindex: true,
  });
}

// The workspace loads its own data through the browser client so that a guest
// (whose session cookie is written client-side) and a signed-in client behave
// identically. RLS scopes both to their own auth.uid(). ProjectClaimGate first
// handles an emailed link's #key= (D6, 0045), then renders the workspace.
export const dynamic = "force-dynamic";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  return (
    <MessagesScope scope="project">
    <div className="container max-w-3xl py-8">
      <ProjectClaimGate projectId={id} />
    </div>
    </MessagesScope>
  );
}
