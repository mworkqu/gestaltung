import type { ReactNode } from "react";

/** Isolates LTR content (file names, codes, emails, measurements) inside RTL text. */
export function Ltr({
  children,
  className,
  as,
}: {
  children: ReactNode;
  className?: string;
  as?: "span" | "div" | "p" | "bdi" | "code";
}) {
  const Tag = as ?? "span";
  return (
    <Tag dir="ltr" className={className} style={{ unicodeBidi: "isolate" }}>
      {children}
    </Tag>
  );
}
