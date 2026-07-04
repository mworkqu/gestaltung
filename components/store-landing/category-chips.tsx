"use client";

import { useState } from "react";

// Category chip row under the hero search — active chip gets the soft accent
// treatment, exactly like the design prototype (visual filter only for now;
// the full catalog filters live on the store page).
export function CategoryChips({ labels }: { labels: string[] }) {
  const [active, setActive] = useState(0);

  return (
    <div className="mt-[18px] flex flex-wrap gap-2">
      {labels.map((label, i) => (
        <button
          key={label}
          type="button"
          onClick={() => setActive(i)}
          className="rounded-[20px] border px-[15px] py-[7px] text-[13px] transition-colors"
          style={
            i === active
              ? {
                  background: "var(--sl-soft-bg)",
                  color: "var(--sl-accent)",
                  borderColor: "var(--sl-soft-border)",
                }
              : {
                  background: "var(--sl-chip-bg)",
                  color: "var(--sl-muted)",
                  borderColor: "var(--sl-chip-border)",
                }
          }
        >
          {label}
        </button>
      ))}
    </div>
  );
}
