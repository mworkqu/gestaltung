import { setRequestLocale } from "next-intl/server";

import { ProjectWorkspace } from "@/components/projects/project-workspace";

// The workspace loads its own data through the browser client so that a guest
// (whose session cookie is written client-side) and a signed-in client behave
// identically. RLS scopes both to their own auth.uid().
export const dynamic = "force-dynamic";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  return (
    <div className="container max-w-3xl py-8">
      <ProjectWorkspace projectId={id} />
    </div>
  );
}
