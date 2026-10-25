"use client";

// The list of library parts to swap in or add (split out of PartsStep, R8).

import { formatPrice } from "@/lib/parts/format";
import type { StoreCardPart } from "@/lib/store/catalog";
import { useStudioLibrary } from "../../StudioLibraryProvider";
import { STEP_ACCENT } from "@/lib/studio/palette";
import type { LibraryPart } from "@/lib/studio/schema";
import { productFor } from "../../use-studio-cart";
import { PartTile } from "./PartTile";

const accent = STEP_ACCENT.parts;

export function PartChoices({
  parts,
  products,
  locale,
  empty,
  onPick,
}: {
  parts: LibraryPart[];
  products: Map<string, StoreCardPart>;
  locale: "en" | "ar";
  empty: string;
  onPick: (p: LibraryPart) => void;
}) {
  const { getPart } = useStudioLibrary();
  if (!parts.length) return <p className="text-sm text-mutedtext">{empty}</p>;
  return (
    <ul className="space-y-2">
      {parts.map((p) => {
        const product = productFor(p.id, products, getPart);
        return (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => onPick(p)}
              className="tile flex w-full items-center gap-3 p-3 text-start transition-colors hover:bg-white"
            >
              <PartTile part={p} product={product} size={48} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold text-heading">{p.name[locale]}</span>
                <span className="block text-[13px] text-body">{p.blurb[locale]}</span>
              </span>
              {product && (
                <span className="shrink-0 text-sm font-semibold tabular-nums" style={{ color: accent.ink }}>
                  {formatPrice(Number(product.unit_price ?? 0), locale)}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
