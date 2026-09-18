"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Loader2, Plus, Search } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { formatPrice, partName } from "@/lib/parts/format";
import { Tag } from "@/components/ui/tag";
import { cn } from "@/lib/utils";
import type { ClientInventoryItem, Part } from "@/lib/supabase/types";

// ── One search box, inventory first ─────────────────────────────────────────
//
// Results are ordered by what the client already has:
//   1. their own inventory, labelled with the quantity they own
//   2. the store, each row tagged "Buy" with a price
//
// An item that is in BOTH appears once, in the inventory section, with a "buy
// more" action — never twice.
//
// The inventory half requires an account; a guest simply has none, so they see
// the store half only. That is the whole difference.

export type SearchHit = {
  key: string;
  part: Part | null;
  customName: string | null;
  owned: number; // 0 = not in their inventory
};

export function UnifiedSearch({
  onAdd,
  addingKey,
  addedKey,
  autoFocus,
  placeholder,
  reloadKey,
}: {
  onAdd: (hit: SearchHit) => void | Promise<void>;
  addingKey?: string | null;
  addedKey?: string | null;
  autoFocus?: boolean;
  placeholder?: string;
  /** Change this to make the search re-read the inventory it just changed. */
  reloadKey?: number;
}) {
  const t = useTranslations("Projects");
  const tSearch = useTranslations("Search");
  const locale = useLocale();

  const [term, setTerm] = useState("");
  const [parts, setParts] = useState<Part[]>([]);
  const [inventory, setInventory] = useState<ClientInventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const debounced = useDebounced(term, 150);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const [{ data: partRows }, { data: invRows }] = await Promise.all([
        supabase.from("parts").select("*").eq("is_published", true),
        // Returns nothing for a guest — no session, no rows, no error.
        supabase.from("client_inventory_items").select("*"),
      ]);
      if (cancelled) return;
      setParts((partRows ?? []) as Part[]);
      setInventory((invRows ?? []) as ClientInventoryItem[]);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const partsById = useMemo(
    () => new Map(parts.map((p) => [p.id, p])),
    [parts]
  );

  const { ownedHits, storeHits } = useMemo(() => {
    const q = debounced.trim().toLowerCase();
    if (!q) return { ownedHits: [], storeHits: [] };

    const matches = (...fields: (string | null | undefined)[]) =>
      fields.some((f) => f?.toLowerCase().includes(q));

    // 1. Inventory first.
    const owned: SearchHit[] = [];
    const ownedPartIds = new Set<string>();

    for (const row of inventory) {
      const part = row.product_id ? partsById.get(row.product_id) ?? null : null;
      const label = part ? partName(part, locale) : row.custom_name;
      if (!matches(label, part?.sku, row.custom_name)) continue;
      if (part) ownedPartIds.add(part.id);
      owned.push({
        key: part ? `part:${part.id}` : `custom:${row.id}`,
        part,
        customName: row.custom_name,
        owned: row.quantity,
      });
    }

    // 2. The store, minus anything already shown above.
    const store: SearchHit[] = parts
      .filter((p) => !ownedPartIds.has(p.id))
      .filter((p) => matches(partName(p, locale), p.name, p.name_ar, p.sku, p.material))
      .slice(0, 12)
      .map((p) => ({ key: `part:${p.id}`, part: p, customName: null, owned: 0 }));

    return { ownedHits: owned, storeHits: store };
  }, [debounced, inventory, parts, partsById, locale]);

  const hasTerm = debounced.trim().length > 0;
  const nothing = hasTerm && ownedHits.length === 0 && storeHits.length === 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2.5 rounded-2xl border border-white/60 bg-panel px-4 shadow-neu-inset">
        <Search className="h-4 w-4 shrink-0 text-faint" strokeWidth={1.75} />
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder={placeholder ?? t("searchStore")}
          autoFocus={autoFocus}
          className="w-full flex-1 bg-transparent py-3 text-sm text-heading outline-none placeholder:text-faint"
        />
        {loading && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-faint" />}
      </div>

      {nothing && (
        <p className="px-1 text-sm text-mutedtext">{tSearch("noResults")}</p>
      )}

      {ownedHits.length > 0 && (
        <Section label={tSearch("inInventory")}>
          {ownedHits.map((hit) => (
            <Row
              key={hit.key}
              hit={hit}
              locale={locale}
              adding={addingKey === hit.key}
              added={addedKey === hit.key}
              onAdd={onAdd}
              actionLabel={hit.part ? tSearch("useMine") : null}
              ownedLabel={tSearch("youHave", { count: hit.owned })}
            />
          ))}
        </Section>
      )}

      {storeHits.length > 0 && (
        <Section label={tSearch("fromStore")}>
          {storeHits.map((hit) => (
            <Row
              key={hit.key}
              hit={hit}
              locale={locale}
              adding={addingKey === hit.key}
              added={addedKey === hit.key}
              onAdd={onAdd}
              actionLabel={t("addToProject")}
              ownedLabel={null}
            />
          ))}
        </Section>
      )}
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="px-1 text-[11px] font-semibold uppercase tracking-wider text-mutedtext">
        {label}
      </p>
      <ul className="space-y-1.5">{children}</ul>
    </div>
  );
}

function Row({
  hit,
  locale,
  adding,
  added,
  onAdd,
  actionLabel,
  ownedLabel,
}: {
  hit: SearchHit;
  locale: string;
  adding: boolean;
  added: boolean;
  onAdd: (hit: SearchHit) => void | Promise<void>;
  actionLabel: string | null;
  ownedLabel: string | null;
}) {
  const tSearch = useTranslations("Search");
  const label = hit.part ? partName(hit.part, locale) : hit.customName;

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-panel px-3 py-2.5 shadow-neu-sm">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-heading">{label}</span>
        {hit.part && (
          <span className="block truncate font-mono text-[11px] text-mutedtext">
            {hit.part.sku}
          </span>
        )}
      </span>

      {ownedLabel && <Tag variant="inventory">{ownedLabel}</Tag>}

      {hit.part && (
        <Tag variant="buy">
          {tSearch("buy")} · {formatPrice(hit.part.unit_price, locale)}
        </Tag>
      )}

      {actionLabel && (
        <button
          type="button"
          onClick={() => onAdd(hit)}
          disabled={adding || added}
          className={cn(
            "shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
            added
              ? "bg-buy-bg text-buy"
              : "bg-cobalt text-white hover:bg-cobalt-hover disabled:opacity-60"
          )}
        >
          {adding ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : added ? (
            tSearch("added")
          ) : (
            <>
              <Plus className="me-1 inline h-3 w-3" />
              {actionLabel}
            </>
          )}
        </button>
      )}
    </li>
  );
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  const ref = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (ref.current) clearTimeout(ref.current);
    ref.current = setTimeout(() => setV(value), ms);
    return () => {
      if (ref.current) clearTimeout(ref.current);
    };
  }, [value, ms]);
  return v;
}
