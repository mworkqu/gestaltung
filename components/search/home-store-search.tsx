"use client";

// Home "Shop parts" search (W7): the same GET form to /{locale}/store as
// before (works before hydration; Enter = full results page), plus instant
// results once the visitor focuses or types (components/search/suggest-shell.tsx).

import { useId, useRef, useState } from "react";
import { Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { comboboxAttrs, LazyStoreSuggest, useSuggestArmed } from "./suggest-shell";

export function HomeStoreSearch({ locale, placeholder, submitLabel }: { locale: string; placeholder: string; submitLabel: string }) {
  const listId = useId();
  const form = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [armed, arm] = useSuggestArmed();

  return (
    <form ref={form} action={`/${locale}/store`} role="search" className="relative flex items-stretch gap-2">
      <div className="flex min-w-0 flex-1 items-center gap-2 rounded-2xl border border-white/60 bg-panel px-3 shadow-neu-inset">
        <Search className="h-4 w-4 shrink-0 text-faint" strokeWidth={1.75} aria-hidden />
        <input
          ref={input}
          name="q"
          type="search"
          aria-label={placeholder}
          placeholder={placeholder}
          maxLength={100}
          enterKeyHint="search"
          value={query}
          onFocus={arm}
          onChange={(e) => {
            setQuery(e.target.value);
            arm();
          }}
          {...comboboxAttrs(listId)}
          className="w-full min-w-0 flex-1 bg-transparent py-2.5 text-sm text-heading outline-none placeholder:text-faint [&::-webkit-search-cancel-button]:hidden"
        />
      </div>
      <Button type="submit" className="rounded-2xl px-4">
        {submitLabel}
      </Button>
      {armed && <LazyStoreSuggest query={query} input={input} wrapper={form} listId={listId} />}
    </form>
  );
}
