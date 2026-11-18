// Small CAD Champions mark: an isometric cube in a cobalt tile. Decorative
// (the link around it carries the accessible name). [TODO-MO: brand colors and logo]
export function CcMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground shadow-neu-sm ${className ?? ""}`}
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinejoin="round">
        <path d="M12 3 20 7.5v9L12 21l-8-4.5v-9L12 3Z" />
        <path d="M4 7.5 12 12l8-4.5M12 12v9" />
      </svg>
    </span>
  );
}
