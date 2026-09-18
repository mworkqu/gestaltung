"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ImagePlus, Loader2, Plus, Trash2 } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import { getCurrentUser, isGuest } from "@/lib/supabase/guest";
import { formatPrice, partName } from "@/lib/parts/format";
import {
  MAX_PROJECT_IMAGE_BYTES,
  PROJECT_IMAGE_ACCEPT,
  PROJECT_IMAGE_BUCKET,
} from "@/lib/projects/constants";
import { UnifiedSearch, type SearchHit } from "@/components/search/unified-search";
import { Tag } from "@/components/ui/tag";
import { Button } from "@/components/ui/button";
import type { ClientInventoryItem, Part } from "@/lib/supabase/types";

// ── The client's own inventory ──────────────────────────────────────────────
//
// Things they own or want to track, independent of the cart: any store item,
// bought here or not, plus custom items we do not sell.
//
// This is NOT the workshop's tenant-scoped production stock (inventory_items).
// Different table, different purpose, deliberately different wording.
//
// Requires an account. A guest is shown the sign-up prompt instead — and
// because signing up keeps the same auth.uid(), whatever they were doing
// survives the trip.

type Row = ClientInventoryItem & { part: Part | null };

export function MyInventory() {
  const t = useTranslations("MyInventory");
  const locale = useLocale();

  const [rows, setRows] = useState<Row[] | null>(null);
  const [guest, setGuest] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [addingKey, setAddingKey] = useState<string | null>(null);
  const [addedKey, setAddedKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    const user = await getCurrentUser();
    if (!user) {
      setSignedOut(true);
      setRows([]);
      return;
    }
    if (isGuest(user)) {
      setGuest(true);
      setRows([]);
      return;
    }

    const { data } = await createClient()
      .from("client_inventory_items")
      .select("*, part:parts(*)")
      .order("created_at", { ascending: false });
    setRows((data ?? []) as Row[]);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function addFromStore(hit: SearchHit) {
    if (!hit.part) return;
    setAddingKey(hit.key);
    try {
      const user = await getCurrentUser();
      if (!user || isGuest(user)) return;
      const supabase = createClient();

      const { data: existing } = await supabase
        .from("client_inventory_items")
        .select("id, quantity")
        .eq("user_id", user.id)
        .eq("product_id", hit.part.id)
        .maybeSingle();

      if (existing) {
        await supabase
          .from("client_inventory_items")
          .update({ quantity: existing.quantity + 1 })
          .eq("id", existing.id);
      } else {
        await supabase.from("client_inventory_items").insert({
          user_id: user.id,
          product_id: hit.part.id,
          quantity: 1,
        });
      }
      await load();
      setAddedKey(hit.key);
      setTimeout(() => setAddedKey(null), 1200);
    } finally {
      setAddingKey(null);
    }
  }

  async function setQuantity(row: Row, quantity: number) {
    const supabase = createClient();
    if (quantity <= 0) {
      if (row.image_path) {
        await supabase.storage.from(PROJECT_IMAGE_BUCKET).remove([row.image_path]);
      }
      await supabase.from("client_inventory_items").delete().eq("id", row.id);
    } else {
      await supabase.from("client_inventory_items").update({ quantity }).eq("id", row.id);
    }
    await load();
  }

  if (rows === null) {
    return (
      <div className="neu flex items-center justify-center p-12">
        <Loader2 className="h-5 w-5 animate-spin text-mutedtext" />
      </div>
    );
  }

  // Guests and signed-out visitors get the same prompt: this one needs an
  // account, and signing up costs them nothing they've already done.
  if (guest || signedOut) {
    return (
      <div className="neu space-y-4 p-8 text-center sm:p-12">
        <h2 className="text-lg font-bold text-heading">{t("signInHeading")}</h2>
        <p className="mx-auto max-w-md text-sm leading-relaxed text-mutedtext">
          {t("signInBody")}
        </p>
        <Button asChild size="lg">
          <Link href="/sign-up">{t("signInCta")}</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="neu space-y-4 p-6 sm:p-8">
        <UnifiedSearch
          onAdd={addFromStore}
          addingKey={addingKey}
          addedKey={addedKey}
          placeholder={t("addToInventory")}
        />
      </section>

      <AddCustomItem onAdded={load} />

      <section className="neu space-y-4 p-6 sm:p-8">
        <h2 className="text-sm font-semibold text-heading">{t("heading")}</h2>
        {rows.length === 0 ? (
          <p className="text-sm text-mutedtext">{t("empty")}</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-panel px-3 py-2.5 shadow-neu-sm"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-heading">
                    {row.part ? partName(row.part, locale) : row.custom_name}
                  </span>
                  {row.part && (
                    <span className="block truncate font-mono text-[11px] text-mutedtext">
                      {row.part.sku} · {formatPrice(row.part.unit_price, locale)}
                    </span>
                  )}
                </span>

                <Tag variant={row.part ? "buy" : "neutral"}>
                  {row.part ? t("fromStore") : t("own")}
                </Tag>

                <input
                  type="number"
                  min={0}
                  value={row.quantity}
                  aria-label={t("quantity")}
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10);
                    if (Number.isFinite(n)) void setQuantity(row, n);
                  }}
                  className="w-16 rounded-lg border border-white/60 bg-surface px-2 py-1 text-center text-sm text-heading shadow-neu-inset outline-none focus:ring-2 focus:ring-cobalt/60"
                />

                <button
                  type="button"
                  onClick={() => setQuantity(row, 0)}
                  aria-label={t("remove")}
                  className="shrink-0 rounded-md p-1.5 text-mutedtext transition-colors hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function AddCustomItem({ onAdded }: { onAdded: () => Promise<void> }) {
  const t = useTranslations("MyInventory");
  const [name, setName] = useState("");
  const [qty, setQty] = useState(1);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t("nameRequired"));
      return;
    }
    setError(null);
    setBusy(true);

    try {
      const user = await getCurrentUser();
      if (!user) return;
      const supabase = createClient();

      let imagePath: string | null = null;
      if (file) {
        if (file.size > MAX_PROJECT_IMAGE_BYTES) {
          setError(t("imageTooLarge"));
          setBusy(false);
          return;
        }
        const ext = file.name.split(".").pop() ?? "png";
        const path = `${user.id}/inventory/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from(PROJECT_IMAGE_BUCKET)
          .upload(path, file);
        if (upErr) {
          setError(t("uploadFailed"));
          setBusy(false);
          return;
        }
        imagePath = path;
      }

      await supabase.from("client_inventory_items").insert({
        user_id: user.id,
        custom_name: trimmed,
        quantity: Math.max(1, qty),
        image_path: imagePath,
      });

      setName("");
      setQty(1);
      setFile(null);
      await onAdded();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="neu space-y-4 p-6 sm:p-8">
      <h2 className="text-sm font-semibold text-heading">{t("addCustom")}</h2>

      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <div className="space-y-1.5">
          <label htmlFor="inv-name" className="block text-xs font-medium text-mutedtext">
            {t("customName")}
          </label>
          <input
            id="inv-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("customNamePlaceholder")}
            className="w-full rounded-xl border border-white/60 bg-panel px-3 py-2.5 text-sm text-heading shadow-neu-inset outline-none placeholder:text-faint focus:ring-2 focus:ring-cobalt/60"
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="inv-qty" className="block text-xs font-medium text-mutedtext">
            {t("quantity")}
          </label>
          <input
            id="inv-qty"
            type="number"
            min={1}
            value={qty}
            onChange={(e) => setQty(parseInt(e.target.value, 10) || 1)}
            className="w-24 rounded-xl border border-white/60 bg-panel px-3 py-2.5 text-center text-sm text-heading shadow-neu-inset outline-none focus:ring-2 focus:ring-cobalt/60"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="inline-flex items-center rounded-lg bg-panel px-3 py-1.5 text-xs font-semibold text-heading shadow-neu-sm transition-colors hover:text-cobalt"
        >
          <ImagePlus className="me-1.5 h-3.5 w-3.5" />
          {t("photo")}
        </button>
        {file && <span className="truncate text-xs text-mutedtext">{file.name}</span>}
        <input
          ref={fileRef}
          type="file"
          accept={PROJECT_IMAGE_ACCEPT}
          hidden
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </div>

      {error && <p className="text-sm font-medium text-destructive">{error}</p>}

      <Button type="submit" disabled={busy}>
        {busy ? (
          <>
            <Loader2 className="me-2 h-4 w-4 animate-spin" />
            {t("adding")}
          </>
        ) : (
          <>
            <Plus className="me-2 h-4 w-4" />
            {t("add")}
          </>
        )}
      </Button>
    </form>
  );
}
