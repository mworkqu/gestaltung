import { useLocale } from "next-intl";

import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

// Centered neomorphic card used by both sign-in and sign-up. Keeps the azure /
// "precision" look consistent with the marketing pages.
export function AuthShell({
  kicker,
  heading,
  intro,
  children,
  altPrompt,
  altLabel,
  altHref,
}: {
  kicker: string;
  heading: string;
  intro: string;
  children: React.ReactNode;
  altPrompt: string;
  altLabel: string;
  altHref: string;
}) {
  const locale = useLocale();
  const isRtl = locale === "ar";
  const mono = (extra = "") =>
    cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  return (
    <div className="container flex min-h-[calc(100vh-12rem)] items-center justify-center py-16">
      <div className="neu w-full max-w-md p-8 sm:p-10">
        <p className={mono("text-[10px] text-azure")}>{kicker}</p>
        <h1 className="mt-3 text-2xl font-extrabold text-heading">{heading}</h1>
        <p className="mt-2 text-sm leading-relaxed text-body">{intro}</p>

        <div className="mt-8">{children}</div>

        <p className="mt-8 text-center text-sm text-mutedtext">
          {altPrompt}{" "}
          <Link
            href={altHref}
            className="font-semibold text-azure transition-colors hover:text-cobalt-hover"
          >
            {altLabel}
          </Link>
        </p>
      </div>
    </div>
  );
}

// Recessed "well" input, matching components/contact-form.tsx.
export const authFieldClass =
  "w-full rounded-xl border border-white/60 bg-panel px-4 py-3 text-sm text-heading shadow-neu-inset transition placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-cobalt/60";
