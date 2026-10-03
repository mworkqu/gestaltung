import { Fragment } from "react";

import { hasArabic, splitBidiRuns } from "@/lib/text/bidi";

/**
 * Renders a title with every Latin/digit run (part numbers, brands, units)
 * wrapped in <bdi dir="ltr"> so it keeps its order inside Arabic text. Plain
 * text when the locale isn't Arabic or the string has no Arabic letters.
 * Works in server and client components (no hooks).
 */
export function IsolatedTitle({ text, locale }: { text: string; locale?: string }) {
  if ((locale && locale !== "ar") || !hasArabic(text)) return <>{text}</>;
  return (
    <>
      {splitBidiRuns(text).map((run, i) =>
        run.ltr ? (
          <bdi key={i} dir="ltr">
            {run.text}
          </bdi>
        ) : (
          <Fragment key={i}>{run.text}</Fragment>
        ),
      )}
    </>
  );
}

/**
 * Inline LTR isolate for phone numbers and amounts ("QAR 1,250.00") inside
 * Arabic sentences, so the number does not flip.
 */
export function Ltr({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <bdi dir="ltr" className={className}>
      {children}
    </bdi>
  );
}
