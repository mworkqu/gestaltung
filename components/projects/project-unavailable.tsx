import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";

// The "This project isn't available here" body, shared by the project page and
// the prototyping workspace. The project's name is deliberately NOT shown: it
// can't be read without owning the project (RLS), and a foreign project must
// not be confirmed to exist (audit #9).
//
// A visitor with no account (no session, or a guest session) also gets the
// guest explanation: projects live in the browser they were started on.
export function ProjectUnavailable({
  signedIn,
  children,
}: {
  signedIn: boolean;
  /** Optional lead-in (title/body) rendered above the guest note. */
  children?: React.ReactNode;
}) {
  const t = useTranslations("Projects");
  return (
    <div className="space-y-4">
      {children}
      {!signedIn && (
        <p className="mx-auto max-w-md text-base text-body">{t("unavailableGuestNote")}</p>
      )}
      <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
        {!signedIn && (
          <Button asChild size="lg">
            <Link href="/sign-up">{t("unavailableSignUp")}</Link>
          </Button>
        )}
        <Button asChild size="lg" variant={signedIn ? "default" : "outline"}>
          <Link href="/projects">{t("unavailableMyProjects")}</Link>
        </Button>
      </div>
      {!signedIn && (
        <p>
          <Link
            href="/sign-in"
            className="inline-flex min-h-11 items-center text-sm font-semibold text-mutedtext underline underline-offset-2 transition-colors hover:text-heading"
          >
            {t("signInCta")}
          </Link>
        </p>
      )}
    </div>
  );
}
