import * as React from "react";

import { cn } from "@/lib/utils";

export function Card({
  as: Tag = "div",
  className,
  children,
}: {
  as?: React.ElementType;
  className?: string;
  children: React.ReactNode;
}) {
  const Component = Tag as React.ElementType<{ className?: string; children?: React.ReactNode }>;
  return <Component className={cn("neu p-6 sm:p-8", className)}>{children}</Component>;
}

export function CardHeader({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("mb-4 flex flex-col gap-1", className)}>{children}</div>;
}

export function CardBody({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("text-body", className)}>{children}</div>;
}
