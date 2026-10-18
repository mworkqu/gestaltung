import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { pageMetadata } from "@/lib/seo";

import { createClient } from "@/lib/supabase/server";
import { ProjectClaimGate } from "@/components/projects/project-claim-gate";
import { MessagesScope } from "@/components/i18n/messages-scope";
import { TurnstileChallenge } from "@/components/turnstile-challenge";
import { turnstileEnabledForPages } from "@/lib/turnstile-server";
import { getSessionContext } from "@/lib/auth/get-session";
import { PROJECT_HREF_COLUMNS, isStudioProject, studioRedirectPath, type ProjectHrefRow } from "@/lib/projects/href";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whether this visitor's session can read the project AND it is a product project
 * (Studio). false = unreadable here (no session yet, e.g. a #key= recovery link in a
 * fresh browser; not theirs) or not a product project: render the page as before.
 */
async function isReadableStudioProject(id: string): Promise<boolean> {
  if (!UUID.test(id)) return false;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return false;
    let res = await supabase.from("projects").select(`id, ${PROJECT_HREF_COLUMNS}`).eq("id", id).maybeSingle();
    // Before migration 0068 there is no studio_version.
    if (res.error) res = await supabase.from("projects").select("id, ai_consent:spec->aiConsent").eq("id", id).maybeSingle();
    if (res.error || !res.data) return false;
    return isStudioProject(res.data as unknown as ProjectHrefRow);
  } catch {
    return false;
  }
}

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
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  // Product projects open straight in the Studio (2026-10-12), with every query
  // parameter kept (?getItMade=1, ?step=…). A super_admin can still open the
  // page itself with ?view=page. A #key= fragment survives a redirect, and a
  // visitor without a session yet falls through to the claim gate below, whose
  // router.refresh() lands here again with the new session.
  const sp = await searchParams;
  const asPage = sp.view === "page" && (await getSessionContext().catch(() => null))?.profile.role === "super_admin";
  if (!asPage && (await isReadableStudioProject(id))) {
    redirect(studioRedirectPath(locale, id, sp));
  }

  const tp = await getTranslations("Projects");
  return (
    <MessagesScope scope="project">
    <div className="container max-w-3xl py-8">
      <div className="mb-3 flex justify-end">
        <Link href={`/projects/${id}/engineering`} className="inline-flex min-h-11 items-center text-sm font-semibold text-cobalt hover:text-cobalt-hover">
          {tp("engineeringView")}
        </Link>
      </div>
      <ProjectClaimGate projectId={id} />
      {/* P2-08: the claim gate (a #key= link in a fresh browser) mints a guest
          session; ensureSession() asks this dialog for the token. Off = nothing. */}
      <TurnstileChallenge enabled={await turnstileEnabledForPages()} />
    </div>
    </MessagesScope>
  );
}
