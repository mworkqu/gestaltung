import { cn } from "@/lib/utils";

/**
 * Geometric "G" brand mark — placeholder until the real logo is wired up
 * (Stage 2). A rounded-square outline in azure (#3ea6ff) with an angular
 * G path in light azure (#7cc6ff). Size via className (defaults to 36px).
 */
export function GMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden
      className={cn("h-9 w-9", className)}
    >
      <rect
        x="3"
        y="3"
        width="42"
        height="42"
        rx="11"
        stroke="#3ea6ff"
        strokeWidth="2"
      />
      <path
        d="M33 17 L19 17 L19 31 L33 31 L33 24 L26 24"
        stroke="#7cc6ff"
        strokeWidth="2.5"
        strokeLinejoin="miter"
        strokeLinecap="square"
      />
    </svg>
  );
}
