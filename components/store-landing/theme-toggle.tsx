"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";

export const STORE_THEME_KEY = "gestaltung:store-theme";

// Light/dark switch for the store landing. Light is the default; this toggles
// the `.sl-dark` class on the .store-landing root and persists the choice. The
// initial class (incl. mobile-follows-device-theme) is set pre-paint by the
// inline script in the landing page, so this only reflects + flips it.
export function ThemeToggle() {
  const t = useTranslations("StoreLanding");
  const [dark, setDark] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const root = document.querySelector(".store-landing");
    setDark(!!root?.classList.contains("sl-dark"));
    setMounted(true);
  }, []);

  function toggle() {
    const root = document.querySelector(".store-landing");
    if (!root) return;
    const next = !root.classList.contains("sl-dark");
    root.classList.toggle("sl-dark", next);
    setDark(next);
    try {
      window.localStorage.setItem(STORE_THEME_KEY, next ? "dark" : "light");
    } catch {
      // storage unavailable — the toggle still works for this view
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={t(dark ? "themeLight" : "themeDark")}
      title={t(dark ? "themeLight" : "themeDark")}
      className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--sl-border)] text-[var(--sl-muted)] transition-colors hover:text-[var(--sl-heading)]"
    >
      {/* Render a stable icon until mounted to avoid a hydration mismatch. */}
      {mounted && dark ? (
        <Sun className="h-4 w-4" strokeWidth={1.75} />
      ) : (
        <Moon className="h-4 w-4" strokeWidth={1.75} />
      )}
    </button>
  );
}
