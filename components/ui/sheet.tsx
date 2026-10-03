"use client";

import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

// Minimal accessible side drawer (shadcn "Sheet" API shape). The standard
// shadcn Sheet is built on @radix-ui/react-dialog, which this project does not
// install (and the brief says not to add dependencies), so this is built on the
// native <dialog> element: showModal() gives a real focus trap, an inert page
// behind it, Escape-to-close and focus restore to the trigger, for free.
//
// - Anchored to the inline end (right in English, left in Arabic) with logical
//   utilities, so it mirrors correctly in RTL.
// - Closes on Escape, on the X button and on a click on the backdrop.
// - Locks page scroll while open; the slide-in is skipped for visitors who
//   prefer reduced motion (motion-safe).
// - Children render only while open, so ids inside it never clash with the
//   inline desktop copy of the same controls.
export function Sheet({
  open,
  onOpenChange,
  title,
  closeLabel,
  footer,
  className,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Accessible name of the X button (already translated). */
  closeLabel: string;
  /** Sticky bottom area, e.g. the "Show results" button. */
  footer?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      // Escape and dialog.close() both end up here, so the parent state follows.
      onClose={() => onOpenChange(false)}
      // A click on the dialog element itself (not its content) is the backdrop.
      onClick={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false);
      }}
      className={cn(
        // Reset the UA dialog box: pinned to the end edge, full height.
        "m-0 ms-auto h-[100dvh] max-h-[100dvh] w-[min(22rem,92vw)] max-w-none overflow-hidden border-0 bg-surface p-0 text-body shadow-neu-lg",
        // display only when open: a utility `flex` would defeat the UA display:none.
        "open:flex open:flex-col",
        "backdrop:bg-ink/40",
        "motion-safe:animate-in motion-safe:slide-in-from-right motion-safe:duration-300 rtl:motion-safe:slide-in-from-left",
        className
      )}
    >
      {open && (
        <>
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-borderstrong/40 px-5 py-3">
            <h2 id={titleId} className="text-base font-bold text-heading">
              {title}
            </h2>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              aria-label={closeLabel}
              className="flex h-11 w-11 items-center justify-center rounded-full text-mutedtext transition-colors hover:text-heading focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt/60"
            >
              <X className="h-5 w-5" aria-hidden />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">{children}</div>
          {footer && (
            <div className="shrink-0 border-t border-borderstrong/40 px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              {footer}
            </div>
          )}
        </>
      )}
    </dialog>
  );
}
