import { HeroEnclosure } from "./hero-enclosure";

// Home hero visual (W7), server side: the poster is a plain, eager,
// fetchpriority="high" <img> with two pre-sized WebPs (480 / 960 px wide, made
// by scripts/make-hero-poster.mjs, both well under 60 kB). Deliberately NOT
// next/image: its client code (also pulled in by getImageProps from a server
// component) adds ~6.5 kB gz to the home's first-load JS, and the static files
// need no optimiser (same rule as product photos, lib/store/image-url.ts).
// The client HeroEnclosure only swaps in the live 3D loop later.

export const HERO_POSTER = {
  src: "/home/hero-enclosure.webp",
  small: "/home/hero-enclosure-480.webp",
  width: 960,
  height: 720,
} as const;

export function HeroVisual({ label, className }: { label: string; className?: string }) {
  return (
    <HeroEnclosure
      label={label}
      className={className}
      poster={
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={HERO_POSTER.src}
          srcSet={`${HERO_POSTER.small} 480w, ${HERO_POSTER.src} 960w`}
          sizes="(min-width: 1024px) 560px, calc(100vw - 72px)"
          width={HERO_POSTER.width}
          height={HERO_POSTER.height}
          alt=""
          loading="eager"
          fetchPriority="high"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
        />
      }
    />
  );
}
