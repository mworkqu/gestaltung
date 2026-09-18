import { cn } from "@/lib/utils";

// Small status pill used wherever an item needs to declare what it is.
//
//   buy       — this comes from the store and costs money
//   inventory — you already own this; `count` shows how many
//   neutral   — anything else worth labelling
//
// The colours are theme tokens (--buy / --inventory in globals.css), never
// hardcoded, and every pairing is WCAG AA on both the canvas and a white card.
// Padding uses logical properties so the pill mirrors correctly in Arabic.

type TagVariant = "buy" | "inventory" | "neutral";

const VARIANTS: Record<TagVariant, string> = {
  buy: "bg-buy-bg text-buy",
  inventory: "bg-inventory-bg text-inventory",
  neutral: "bg-panel text-mutedtext",
};

export function Tag({
  variant = "neutral",
  children,
  className,
}: {
  variant?: TagVariant;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full py-0.5 ps-2 pe-2 text-[11px] font-semibold leading-5",
        VARIANTS[variant],
        className
      )}
    >
      {children}
    </span>
  );
}
