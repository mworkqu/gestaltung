"use client";

// A part's photo / icon tile and its hover-tap popover (split out of PartsStep, R8).

import { useTranslations } from "next-intl";
import {
  Binary,
  BatteryCharging,
  Cpu,
  Lightbulb,
  Monitor,
  Plug,
  Radar,
  Settings2,
  ToggleLeft,
  type LucideIcon,
} from "lucide-react";
import { formatPrice, partImageUrl } from "@/lib/parts/format";
import { IMAGE_WIDTHS, sizedImage } from "@/lib/store/image-url";
import type { StoreCardPart } from "@/lib/store/catalog";
import { STEP_ACCENT } from "@/lib/studio/palette";
import { popoverPhoto, stockLine } from "@/lib/studio/part-photo";
import type { Category, LibraryPart } from "@/lib/studio/schema";
import { cn } from "@/lib/utils";

const accent = STEP_ACCENT.parts;

export const CATEGORY_ICON: Record<Category, LucideIcon> = {
  mcu: Cpu,
  power: BatteryCharging,
  sensor: Radar,
  display: Monitor,
  input: ToggleLeft,
  output: Lightbulb,
  actuator: Settings2,
  connector: Plug,
  logic: Binary,
};

export function PartTile({ part, product, size = 56 }: { part: LibraryPart | undefined; product: StoreCardPart | null; size?: number }) {
  const img = product ? partImageUrl(product) : null;
  const Icon = part ? CATEGORY_ICON[part.category] : Cpu;
  return (
    <span
      className="grid shrink-0 place-items-center overflow-hidden rounded-2xl shadow-neu-inset"
      style={{ width: size, height: size, background: img ? "#fff" : accent.soft }}
    >
      {img ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={sizedImage(img, IMAGE_WIDTHS.thumb)!}
          width={size}
          height={size}
          alt=""
          loading="lazy"
          decoding="async"
          className="h-full w-full object-contain"
        />
      ) : (
        <Icon className="h-6 w-6" style={{ color: accent.ink }} strokeWidth={1.5} aria-hidden />
      )}
    </span>
  );
}

/** Hover (mouse) / tap / keyboard popover: store photo (else the icon), name, purpose, price, stock. */
export function PartPopover({
  id,
  part,
  product,
  name,
  purpose,
  locale,
}: {
  id: string;
  part: LibraryPart | undefined;
  product: StoreCardPart | null;
  name: string;
  purpose: string;
  locale: "en" | "ar";
}) {
  const t = useTranslations("Studio.partsPopover");
  const photo = popoverPhoto(product as Parameters<typeof popoverPhoto>[0], 280);
  const Icon = part ? CATEGORY_ICON[part.category] : Cpu;
  const stock = stockLine(product);
  const price = product ? formatPrice(Number(product.unit_price ?? 0) * Math.max(1, product.min_order_qty ?? 1), locale) : null;
  return (
    <div
      id={id}
      role="group"
      aria-label={name}
      className="tile absolute start-0 top-full z-30 mt-2 w-[min(18rem,calc(100vw-3rem))] space-y-2 p-3 text-start shadow-neu motion-safe:animate-rise"
    >
      <div className="grid h-36 place-items-center overflow-hidden rounded-xl" style={{ background: photo ? "#fff" : accent.soft }}>
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo} alt="" width={280} height={144} loading="lazy" decoding="async" className="h-full w-full object-contain" />
        ) : (
          <Icon className="h-12 w-12" style={{ color: accent.ink }} strokeWidth={1.25} aria-hidden />
        )}
      </div>
      <p className="text-sm font-bold text-heading">{name}</p>
      {purpose && <p className="text-[13px] leading-snug text-body">{purpose}</p>}
      <p className="text-[13px] font-semibold" style={{ color: accent.ink }}>
        {price ?? <span className="text-mutedtext">{t("noPrice")}</span>}
      </p>
      <p className="flex items-center gap-1.5 text-[13px] text-body">
        <span
          className={cn("inline-block h-2 w-2 shrink-0 rounded-full", stock.kind === "in_stock" ? "bg-emerald-500" : "bg-amber-400")}
          aria-hidden
        />
        {stock.kind === "in_stock"
          ? t("inStock")
          : stock.cls
            ? t("sourceTime", { time: t(`time_${stock.cls}`) })
            : t("sourceNoTime")}
      </p>
    </div>
  );
}
