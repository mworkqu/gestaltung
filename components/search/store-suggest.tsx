"use client";

// Instant store search (W7), the lazy half: loaded by components/search/suggest-shell.tsx
// only when the visitor first focuses or types in a search box, so none of this
// is in the page's first-load JS.
//
// StoreSuggestController drives an ARIA combobox on an input it does not own
// (the shell renders the input and the form, so the box works before this
// loads and Enter still submits to the full results page):
//   - the query comes from the shell; results are fetched 200 ms after the last
//     keystroke from GET /api/store/search (cached per page load);
//   - ArrowDown / ArrowUp move through the options, Esc closes, Enter on a
//     highlighted option opens that product; Enter with nothing highlighted is
//     left to the form (full results page);
//   - aria-expanded / aria-activedescendant are kept on the input.
// The listbox shows the top 6 products: photo, name, price, delivery class and
// an "Add to cart" button that adds in place (useCart, so the header badge updates).

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Check, Loader2, Plus } from "lucide-react";

import { Link, useRouter } from "@/i18n/navigation";
import { useCart } from "@/components/parts/cart-provider";
import { LeadTimeBadge } from "@/components/parts/lead-time-badge";
import { formatPrice, partName } from "@/lib/parts/format";
import { arabicCountForm } from "@/lib/text/count";
import { cn } from "@/lib/utils";
import { SUGGEST_MIN_CHARS, type StoreSearchResponse, type StoreSuggestion } from "@/lib/store/search-suggest";

const DEBOUNCE_MS = 200;
// One threshold for the box and the route, so they cannot disagree (F-029).
const MIN_CHARS = SUGGEST_MIN_CHARS;

type State = { q: string; results: StoreSuggestion[]; total: number };

// One small in-memory cache per page load: going back over the same letters never refetches.
const cache = new Map<string, State>();

export type StoreSuggestProps = {
  /** What is in the box (owned by the shell). */
  query: string;
  input: RefObject<HTMLInputElement | null>;
  /** Focus / clicks outside this element close the list. */
  wrapper: RefObject<HTMLElement | null>;
  listId: string;
  /** Opened on mount (the shell mounts this on the first focus or keystroke). */
  initiallyOpen?: boolean;
  className?: string;
};

export default function StoreSuggestController({ query, input, wrapper, listId, initiallyOpen = true, className }: StoreSuggestProps) {
  const locale = useLocale();
  const router = useRouter();
  const [data, setData] = useState<State | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(initiallyOpen);
  const [active, setActive] = useState(-1);
  const abort = useRef<AbortController | null>(null);
  const q = query.replace(/\s+/g, " ").trim();

  // Debounced fetch on every change of the query.
  useEffect(() => {
    setActive(-1);
    abort.current?.abort();
    if (q.length < MIN_CHARS) {
      setData(null);
      setLoading(false);
      return;
    }
    const key = `${locale}:${q.toLowerCase()}`;
    const hit = cache.get(key);
    if (hit) {
      setData(hit);
      setLoading(false);
      return;
    }
    setLoading(true);
    const ctrl = new AbortController();
    abort.current = ctrl;
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/store/search?q=${encodeURIComponent(q)}&locale=${locale}`, { signal: ctrl.signal });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as StoreSearchResponse;
        const next = { q, results: body.results ?? [], total: body.total ?? 0 };
        cache.set(key, next);
        setData(next);
      } catch {
        if (ctrl.signal.aborted) return;
        setData({ q, results: [], total: 0 });
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      ctrl.abort();
    };
  }, [q, locale]);

  const results = useMemo(() => data?.results ?? [], [data]);
  const shown = open && q.length >= MIN_CHARS && (loading || data !== null);
  const optionId = useCallback((i: number) => `${listId}-opt-${i}`, [listId]);
  const close = useCallback(() => {
    setOpen(false);
    setActive(-1);
  }, []);

  // Input events: typing / focus open the list; the keyboard moves through it.
  const live = useRef({ results, shown, active });
  live.current = { results, shown, active };
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    const onInput = () => {
      setOpen(true);
      setActive(-1);
    };
    const onFocus = () => setOpen(true);
    const onKey = (e: KeyboardEvent) => {
      const { results: rs, shown: isShown, active: at } = live.current;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        if (!rs.length) return;
        e.preventDefault();
        setOpen(true);
        const n = rs.length;
        setActive((i) => (e.key === "ArrowDown" ? (i + 1) % n : i <= 0 ? n - 1 : i - 1));
      } else if (e.key === "Escape") {
        if (!isShown) return;
        e.preventDefault();
        close();
      } else if (e.key === "Enter") {
        if (isShown && at >= 0 && rs[at]) {
          e.preventDefault();
          close();
          router.push(`/store/${rs[at].sku}`);
        } else close();
      }
    };
    el.addEventListener("input", onInput);
    el.addEventListener("focus", onFocus);
    el.addEventListener("keydown", onKey);
    return () => {
      el.removeEventListener("input", onInput);
      el.removeEventListener("focus", onFocus);
      el.removeEventListener("keydown", onKey);
    };
  }, [input, close, router]);

  // ARIA state lives on the input the shell rendered.
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.setAttribute("aria-expanded", shown ? "true" : "false");
    if (shown && active >= 0) el.setAttribute("aria-activedescendant", optionId(active));
    else el.removeAttribute("aria-activedescendant");
  }, [input, shown, active, optionId]);

  // Focus leaving the box, or a click outside it, closes the list.
  useEffect(() => {
    const el = wrapper.current;
    if (!el) return;
    // Only a focus move to something else (Tab away) closes here; focus falling to the
    // body (the "Add to cart" button swapping to "Added") must not. Clicks are handled below.
    const onOut = (e: FocusEvent) => {
      const next = e.relatedTarget as Node | null;
      if (next && !el.contains(next)) close();
    };
    const onDown = (e: PointerEvent) => {
      if (!el.contains(e.target as Node)) close();
    };
    el.addEventListener("focusout", onOut);
    document.addEventListener("pointerdown", onDown);
    return () => {
      el.removeEventListener("focusout", onOut);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [wrapper, close]);

  if (!shown) return null;
  return (
    <SuggestList
      listId={listId}
      results={results}
      total={data?.total ?? 0}
      loading={loading}
      active={active}
      optionId={optionId}
      onHover={setActive}
      onPick={close}
      seeAllHref={`/store?q=${encodeURIComponent(q)}`}
      className={className}
    />
  );
}

function SuggestList({
  listId,
  results,
  total,
  loading,
  active,
  optionId,
  onHover,
  onPick,
  seeAllHref,
  className,
}: {
  listId: string;
  results: StoreSuggestion[];
  total: number;
  loading: boolean;
  active: number;
  optionId: (i: number) => string;
  onHover: (i: number) => void;
  onPick: () => void;
  seeAllHref: string;
  className?: string;
}) {
  const t = useTranslations("StoreSearch");
  const locale = useLocale();

  return (
    <div
      className={cn(
        "absolute inset-x-0 top-full z-40 mt-2 overflow-hidden rounded-2xl border border-white/60 bg-surface shadow-neu",
        className,
      )}
      data-testid="store-suggest"
    >
      <ul id={listId} role="listbox" aria-label={t("listLabel")} className="max-h-[min(70vh,28rem)] overflow-y-auto py-1">
        {results.map((p, i) => (
          <SuggestRow key={p.id} p={p} id={optionId(i)} active={i === active} onHover={() => onHover(i)} onPick={onPick} locale={locale} />
        ))}
      </ul>
      <div className="flex min-h-11 items-center justify-between gap-3 border-t border-borderstrong/30 px-4 py-2 text-sm" aria-live="polite">
        {loading && !results.length ? (
          <span className="inline-flex items-center gap-2 text-mutedtext">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            {t("searching")}
          </span>
        ) : results.length ? (
          <Link href={seeAllHref} onClick={onPick} className="font-semibold text-cobalt hover:text-cobalt-hover">
            {t("seeAll", { count: String(total), form: arabicCountForm(total) })}
          </Link>
        ) : (
          <span className="text-mutedtext">{t("noMatches")}</span>
        )}
        {loading && results.length > 0 && <Loader2 className="h-4 w-4 animate-spin text-mutedtext" aria-hidden />}
      </div>
    </div>
  );
}

function SuggestRow({
  p,
  id,
  active,
  onHover,
  onPick,
  locale,
}: {
  p: StoreSuggestion;
  id: string;
  active: boolean;
  onHover: () => void;
  onPick: () => void;
  locale: string;
}) {
  const t = useTranslations("StoreSearch");
  const { addItem } = useCart();
  const [added, setAdded] = useState(false);
  // Keyboard users land on "Added" (a link to the cart) instead of losing their place.
  const addedRef = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (added) addedRef.current?.focus();
  }, [added]);
  const [busy, setBusy] = useState(false);
  const name = partName(p, locale);

  return (
    <li
      id={id}
      role="option"
      aria-selected={active}
      onPointerEnter={onHover}
      className={cn("flex items-center gap-3 px-3 py-2", active && "bg-panel")}
    >
      <Link href={`/store/${p.sku}`} tabIndex={-1} aria-label={name} onClick={onPick} className="flex min-w-0 flex-1 items-center gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-panel">
          {p.thumb ? (
            // Eager on purpose: at most six rows, and a lazy image inside the scrolling
            // dropdown stayed blank until scrolled (F-029).
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.thumb} alt="" width={48} height={48} decoding="async" className="h-full w-full object-contain" />
          ) : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 break-words text-sm font-semibold leading-snug text-heading" title={name}>
            {name}
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-bold text-heading">{formatPrice(p.unit_price, locale)}</span>
            <LeadTimeBadge leadClass={p.lead_time_class} />
          </span>
        </span>
      </Link>
      {added ? (
        <Link
          ref={addedRef}
          href="/store/cart"
          onClick={onPick}
          className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-full px-3 text-xs font-semibold text-emerald-700"
        >
          <Check className="h-4 w-4" aria-hidden />
          <span className="max-sm:sr-only">{t("added")}</span>
        </Link>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void addItem({ id: p.id, min_order_qty: p.min_order_qty, sku: p.sku }, p.min_order_qty).then((ok) => {
              setBusy(false);
              if (ok) setAdded(true);
            });
          }}
          aria-label={t("addAria", { name })}
          className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-full bg-cobalt px-3 text-xs font-semibold text-white transition-colors hover:bg-cobalt-hover disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
          {/* Phones: icon only (the button keeps its full aria-label), so the name has room. */}
          <span className="max-sm:sr-only">{t("addToCart")}</span>
        </button>
      )}
    </li>
  );
}
