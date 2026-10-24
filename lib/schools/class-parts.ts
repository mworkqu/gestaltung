// One order for a whole class (3d): every team's Studio parts list turned into
// ONE deduplicated cart, with the pack maths applied once to the summed need.
//
// Why this exists: four teams that each need two LEDs need eight LEDs, which is
// ONE listing of a 10-pack — not four listings of 10. Doing the pack maths per
// team and adding up afterwards buys four times too much, so the quantities are
// summed per store product first and packsFor() runs once on the sum.
//
// Reuses the established pieces rather than re-deriving them:
//   lib/studio/parts-group.ts   groupComponents() — pieces per part id in a doc
//   lib/store/pack.ts           packSizeOf() / packsFor() — the ONE pack rule
// and it is fed exactly what lib/studio/server/quote.ts linkedPrices() returns
// (a Map of store SKU → unit_price), so the server page needs no new read path.
//
// PURE: no I/O, no Next imports, no Supabase. Tested in class-parts.test.ts.

import { packsFor, packSizeOf, type PackProduct } from "@/lib/store/pack";
import { groupComponents } from "@/lib/studio/parts-group";
import type { LibraryPart, StudioDoc } from "@/lib/studio/schema";
import { asLocale } from "@/lib/locale";
import { round2 } from "@/lib/format/money";

/** One team of a class, with the Studio document of its project. */
export type ClassTeamDoc = {
  teamId: string;
  teamName: string;
  projectId: string;
  /** null for a team that has not started, or a document we could not parse. */
  doc: StudioDoc | null;
};

/** What the page knows about a store listing, beyond its price. */
export type ClassPartsProduct = PackProduct & { sku: string };

export type ClassPartsOptions = {
  /** The Studio library lookup (lib/studio/library/remote.ts studioLibrary().getPart). */
  getPart: (id: string) => LibraryPart | undefined;
  /** Store listings by SKU, for the pack size and the minimum order. */
  products?: ReadonlyMap<string, ClassPartsProduct>;
  /** Which language the part names are read in. */
  locale?: "en" | "ar";
};

/** A part one team needs, and how many pieces. */
export type ClassPartNeed = {
  partId: string;
  name: string;
  /** The store listing it maps to (LibraryPart.storeSkus[0]), or null. */
  sku: string | null;
  quantity: number;
};

export type ClassTeamParts = {
  teamId: string;
  teamName: string;
  projectId: string;
  needs: ClassPartNeed[];
  /** Pieces this team needs in total. */
  partCount: number;
  /**
   * This team's indicative share of the goods, QAR: unit price × PIECES. Never
   * pack-rounded — the packs belong to the class order, not to one team.
   */
  goodsQar: number;
};

/** One cart line: one store product for the whole class. */
export type ClassCartLine = {
  sku: string;
  /** The part's plain name, from the first team that asked for it. */
  name: string;
  unitPriceQar: number;
  /** Pieces in one listing. */
  packSize: number;
  /** Pieces the class needs, summed over every team. */
  pieces: number;
  /** Listings to buy: ceil(pieces ÷ packSize), never below the minimum order. */
  packs: number;
  /** unitPriceQar × packs. */
  lineTotalQar: number;
  /** Who asked for it, for the per-team breakdown. */
  teams: { teamId: string; teamName: string; pieces: number }[];
};

/** Why a part is not on the cart: we source it instead of selling it today. */
export type ClassSourcedReason = "no_sku" | "not_listed";

export type ClassSourcedPart = {
  partId: string;
  name: string;
  pieces: number;
  reason: ClassSourcedReason;
  teams: { teamId: string; teamName: string; pieces: number }[];
};

export type ClassPartsPlan = {
  /** Only teams that need something; a team with an empty document is not here. */
  teams: ClassTeamParts[];
  lines: ClassCartLine[];
  /** Parts with no store product, or one we do not list: reported, never dropped. */
  weSource: ClassSourcedPart[];
  /** Σ lineTotalQar, from the lines actually produced. */
  goodsQar: number;
};


function partName(part: LibraryPart | undefined, fallback: string, locale: "en" | "ar"): string {
  const name = part?.name?.[locale] || part?.name?.en;
  return (name || fallback || "").trim() || fallback;
}

type Bucket = {
  partId: string;
  name: string;
  sku: string | null;
  pieces: number;
  teams: { teamId: string; teamName: string; pieces: number }[];
};

/**
 * The class order: per team what it needs, one deduplicated line per store
 * product with the quantities summed and the pack maths applied ONCE, the goods
 * total, and the parts we have to source.
 */
export function classPartsPlan(
  teams: readonly ClassTeamDoc[],
  prices: ReadonlyMap<string, number>,
  options: ClassPartsOptions,
): ClassPartsPlan {
  const locale = asLocale(options.locale);
  const { getPart, products } = options;

  // part id → summed need across the class, in first-seen order.
  const buckets = new Map<string, Bucket>();
  const teamRows: ClassTeamParts[] = [];

  for (const team of teams) {
    const components = team.doc?.components ?? [];
    if (components.length === 0) continue;

    const needs: ClassPartNeed[] = [];
    // Pieces per part id in this doc (auto helper parts counted too: a resistor
    // the rules added is still a resistor somebody has to buy).
    for (const group of groupComponents(components)) {
      const part = getPart(group.partId);
      const name = partName(part, group.first.label || group.partId, locale);
      const sku = part?.storeSkus?.[0]?.trim() || null;
      const quantity = Math.max(1, Math.trunc(group.quantity) || 1);
      needs.push({ partId: group.partId, name, sku, quantity });

      const bucket = buckets.get(group.partId);
      if (bucket) {
        bucket.pieces += quantity;
        bucket.teams.push({ teamId: team.teamId, teamName: team.teamName, pieces: quantity });
      } else {
        buckets.set(group.partId, {
          partId: group.partId,
          name,
          sku,
          pieces: quantity,
          teams: [{ teamId: team.teamId, teamName: team.teamName, pieces: quantity }],
        });
      }
    }

    const partCount = needs.reduce((n, x) => n + x.quantity, 0);
    const goodsQar = round2(
      needs.reduce((s, x) => s + (x.sku ? (prices.get(x.sku) ?? 0) : 0) * x.quantity, 0),
    );
    teamRows.push({
      teamId: team.teamId,
      teamName: team.teamName,
      projectId: team.projectId,
      needs,
      partCount,
      goodsQar,
    });
  }

  const lines: ClassCartLine[] = [];
  const weSource: ClassSourcedPart[] = [];

  for (const bucket of buckets.values()) {
    const price = bucket.sku ? prices.get(bucket.sku) : undefined;
    if (!bucket.sku || !Number.isFinite(price) || (price as number) <= 0) {
      weSource.push({
        partId: bucket.partId,
        name: bucket.name,
        pieces: bucket.pieces,
        reason: bucket.sku ? "not_listed" : "no_sku",
        teams: bucket.teams,
      });
      continue;
    }
    const product: ClassPartsProduct = products?.get(bucket.sku) ?? { sku: bucket.sku };
    // ONE pack calculation, on the summed need.
    const packSize = packSizeOf(product);
    const packs = packsFor(bucket.pieces, product);
    lines.push({
      sku: bucket.sku,
      name: bucket.name,
      unitPriceQar: price as number,
      packSize,
      pieces: bucket.pieces,
      packs,
      lineTotalQar: round2((price as number) * packs),
      teams: bucket.teams,
    });
  }

  return {
    teams: teamRows,
    lines,
    weSource,
    goodsQar: round2(lines.reduce((s, l) => s + l.lineTotalQar, 0)),
  };
}

export type ClassPartsSummary = {
  /** Teams that need something. */
  teamCount: number;
  /** Cart lines (store products). */
  lineCount: number;
  /** Pieces the class needs, over the lines we can sell. */
  partCount: number;
  goodsQar: number;
};

/** The numbers the class table and the invoice message show. */
export function classPartsSummary(plan: ClassPartsPlan): ClassPartsSummary {
  return {
    teamCount: plan.teams.length,
    lineCount: plan.lines.length,
    partCount: plan.lines.reduce((n, l) => n + l.pieces, 0),
    goodsQar: plan.goodsQar,
  };
}
