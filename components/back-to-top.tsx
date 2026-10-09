"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowUp } from "lucide-react";

const SHOW_AFTER_PX = 600;

// Floating "back to top" button for long lists (the store). Appears after
// 600 px of scroll, jumps instantly (not smoothly) when the visitor prefers
// reduced motion, and sits above the iOS home indicator via the safe-area
// inset. Bottom-end corner, under the sticky header's z-index and the modals',
// so it never covers the header's cart / language controls or a dialog.
export function BackToTop() {
  const t = useTranslations("Parts");
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > SHOW_AFTER_PX);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!visible) return null;

  function toTop() {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  }

  return (
    <button
      type="button"
      onClick={toTop}
      aria-label={t("backToTop")}
      className="fixed print:hidden bottom-[calc(1rem+env(safe-area-inset-bottom))] end-4 z-30 flex h-11 w-11 items-center justify-center rounded-full bg-ink text-white shadow-neu transition-colors hover:bg-cobalt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt/60 focus-visible:ring-offset-2 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200"
    >
      <ArrowUp className="h-5 w-5" strokeWidth={1.75} aria-hidden />
    </button>
  );
}
