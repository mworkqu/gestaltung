import { Box } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { loadContinueProjects, shapeContinueProjects, type ContinueProject } from "@/lib/admin/continue-projects";
import { createClient } from "@/lib/supabase/server";
import { STEP_ACCENT } from "@/lib/studio/palette";

// D4: Home "Continue where you left off". The admin's own projects (as a customer), the last
// three they touched. One small query (names + the remembered step only); the projects list
// has no picture for a project, so the thumbnail is an icon tile in the step's own colour.
// Streams in behind a Suspense boundary like the tiles, so it never blocks the page.
export async function ContinueCard() {
  const db = await createClient();
  const { data } = await db.auth.getUser().catch(() => ({ data: { user: null } }));
  const user = data.user;
  const t = await getTranslations("AdminHome");
  if (!user) return <ContinueCardView projects={[]} />;
  const rows = await loadContinueProjects(db, user.id).catch(() => null);
  if (rows === null) return <ContinueCardView projects={null} />;
  return <ContinueCardView projects={shapeContinueProjects(rows, t("continueUntitled"))} />;
}

/** The card for given projects (null = could not be read). No I/O of its own. */
export async function ContinueCardView({ projects }: { projects: ContinueProject[] | null }) {
  const t = await getTranslations("AdminHome");
  const tStudio = await getTranslations("Studio");
  return (
    <section aria-labelledby="home-continue" className="space-y-4">
      <div>
        <h2 id="home-continue" className="text-lg font-extrabold text-heading">
          {t("continueTitle")}
        </h2>
        <p className="mt-1 text-sm text-mutedtext">{t("continueIntro")}</p>
      </div>
      {projects === null ? (
        <p role="alert" className="neu p-5 text-sm text-destructive">
          {t("continueError")}
        </p>
      ) : projects.length === 0 ? (
        <p className="neu p-5 text-sm text-mutedtext">{t("continueEmpty")}</p>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {projects.map((p) => {
            const accent = p.step ? STEP_ACCENT[p.step] : STEP_ACCENT.idea;
            return (
              <li key={p.id}>
                <Link
                  href={p.href}
                  aria-label={`${t("continueOpen")}: ${p.name}`}
                  className="neu neu-hover flex h-full min-h-11 items-center gap-3 p-4 transition-shadow"
                >
                  <span
                    aria-hidden
                    className="grid h-14 w-14 shrink-0 place-items-center rounded-xl"
                    style={{ background: accent.soft, color: accent.ink }}
                  >
                    <Box className="h-6 w-6" />
                  </span>
                  <span className="min-w-0">
                    <span className="block break-words text-base font-semibold text-heading">{p.name}</span>
                    <span className="mt-0.5 block text-xs text-mutedtext">
                      {p.step ? t("continueStep", { step: tStudio(`step_${p.step}`) }) : t("continueNoStep")}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function ContinueCardSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3" aria-hidden>
      {[0, 1, 2].map((i) => (
        <div key={i} className="neu h-[88px] animate-pulse motion-reduce:animate-none" />
      ))}
    </div>
  );
}
