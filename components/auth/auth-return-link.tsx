"use client";

// A "Sign in" / "Create account" link that brings the visitor back to the page
// they are on (W1). The href carries ?next=<current path + query>, read from
// window.location at click time, because the Studio changes ?step= with
// history.replaceState and a value captured at render could be stale.
// Reusable anywhere a guest has work in progress.

import { useEffect, useState } from "react";
import NextLink from "next/link";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";

import { signInHref, signUpHref } from "@/lib/auth/next-path";

/** The page the visitor is on now, with its query ("/en/projects/x/studio?step=wiring"). */
export function currentReturnPath(): string | null {
  if (typeof window === "undefined") return null;
  return `${window.location.pathname}${window.location.search}`;
}

type AnchorProps = Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href">;

/** Extra anchor props (className, aria-*, data-*) pass through, so it also works under <Button asChild>. */
export function AuthReturnLink({
  kind = "sign-in",
  children,
  onClick,
  ...rest
}: AnchorProps & {
  kind?: "sign-in" | "sign-up";
  children: React.ReactNode;
}) {
  const locale = useLocale();
  const router = useRouter();
  const build = kind === "sign-up" ? signUpHref : signInHref;
  // Server render + first paint: the bare page; corrected after mount.
  const [href, setHref] = useState(() => build(locale, null));
  useEffect(() => {
    setHref(build(locale, currentReturnPath()));
  }, [build, locale]);

  return (
    <NextLink
      {...rest}
      href={href}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented) return;
        const fresh = build(locale, currentReturnPath());
        // New tab / window: let the browser follow the (refreshed) href itself.
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) {
          e.currentTarget.href = fresh;
          return;
        }
        e.preventDefault();
        router.push(fresh);
      }}
    >
      {children}
    </NextLink>
  );
}
