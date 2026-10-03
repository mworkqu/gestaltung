import { BRAND_MARK_PATH } from "@/lib/brand-mark";
import { cn } from "@/lib/utils";

/**
 * Gestaltung logo — the angular "G" brand mark as inline vector (traced from the
 * original 1024px master). Inline SVG means it's crisp at any size and ships in
 * the HTML with zero extra network request (never re-downloaded per page).
 *
 * Filled with a light metallic-blue gradient so it reads on the dark `bg-ink`
 * header chip. Size via className (defaults to 20px). Pass a unique `gradientId`
 * if rendering more than once on the same page.
 */
export function LogoMark({
  className,
  title = "Gestaltung",
  gradientId = "gestaltung-logo",
}: {
  className?: string;
  title?: string;
  gradientId?: string;
}) {
  return (
    <svg
      viewBox="0 0 1024 1024"
      role="img"
      aria-label={title}
      className={cn("h-5 w-5", className)}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f1f6fc" />
          <stop offset="0.55" stopColor="#cdddf2" />
          <stop offset="1" stopColor="#7ea6e0" />
        </linearGradient>
      </defs>
      <path
        fill={`url(#${gradientId})`}
        fillRule="evenodd"
        d={BRAND_MARK_PATH}
      />
    </svg>
  );
}
