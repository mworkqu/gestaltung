// The panel every section of /dashboard/customers/<id> sits in, plus what the
// sections share: the formatters (built once per request in page.tsx) and the
// table cell classes. Split out of page.tsx (R8).

import type { getTranslations } from "next-intl/server";

export type CustomerFmt = {
  t: Awaited<ReturnType<typeof getTranslations<"Customers">>>;
  num: Intl.NumberFormat;
  usd: (n: number) => string;
  day: (v: unknown) => string;
  time: (v: unknown) => string;
  text: (v: unknown) => string;
  count: (v: unknown) => string;
  money: (v: unknown) => string;
  yesNo: (v: unknown) => string;
  clip: (v: unknown, n?: number) => string;
};

export const th = "pb-2 font-medium";
export const tdn = "py-2 text-end font-mono tabular-nums";
export const td = "py-2 text-[12px] text-body";
export const tdm = "py-2 font-mono text-[12px] text-body";

/**
 * One table in its own panel. An empty section still renders, with its
 * heading and a "none" line, so the owner can see that there is nothing
 * rather than wonder whether the page left it out.
 */
export function Panel({
  title,
  unavailable,
  empty,
  noneLabel,
  children,
}: {
  title: string;
  unavailable?: string;
  empty: boolean;
  noneLabel: string;
  children: React.ReactNode;
}) {
  return (
    <section className="neu space-y-3 p-6">
      <h2 className="text-base font-bold text-heading">{title}</h2>
      {unavailable ? (
        <p className="text-sm font-medium text-destructive">{unavailable}</p>
      ) : empty ? (
        <p className="text-sm text-mutedtext">{noneLabel}</p>
      ) : (
        <div className="overflow-x-auto">{children}</div>
      )}
    </section>
  );
}
