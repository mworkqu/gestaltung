"use client";

import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";

import { useAuth } from "@/components/auth/auth-provider";
import { Link } from "@/i18n/navigation";

// "My projects" on the new-project pages. A guest has nothing there yet and
// cannot come back to it from another device, so only a real account sees the
// link (F-022). The page itself stays static; this decides in the browser.
export function MyProjectsLink() {
  const t = useTranslations("Projects");
  const { user } = useAuth();
  if (!user || user.is_anonymous) return null;
  return (
    <Link
      href="/projects"
      className="inline-flex items-center gap-1 text-sm font-medium text-cobalt hover:underline"
    >
      {t("myProjectsLink")}
      <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden />
    </Link>
  );
}
