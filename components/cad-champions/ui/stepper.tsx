"use client";

import * as React from "react";
import { CheckCircle2, Circle, CircleDot, Lock, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

export type StepStatus = "done" | "current" | "upcoming" | "locked";

export interface StepperStep {
  id: string;
  label: string;
  description?: string;
  status: StepStatus;
  lockedReason?: string;
}

const icons: Record<StepStatus, LucideIcon> = {
  done: CheckCircle2,
  current: CircleDot,
  upcoming: Circle,
  locked: Lock,
};

const iconColor: Record<StepStatus, string> = {
  done: "text-buy",
  current: "text-accent",
  upcoming: "text-mutedtext",
  locked: "text-mutedtext",
};

const listLayout = {
  auto: "flex-col md:flex-row",
  horizontal: "flex-row",
  vertical: "flex-col",
} as const;

const itemLayout = {
  auto: "md:flex-1",
  horizontal: "flex-1",
  vertical: "",
} as const;

export function Stepper({
  steps,
  orientation = "auto",
  className,
}: {
  steps: StepperStep[];
  orientation?: "auto" | "horizontal" | "vertical";
  className?: string;
}) {
  const t = useTranslations("CC.ui");
  return (
    <ol aria-label={t("stepperLabel")} className={cn("flex gap-3", listLayout[orientation], className)}>
      {steps.map((step, index) => {
        const Icon = icons[step.status];
        return (
          <li
            key={step.id}
            aria-current={step.status === "current" ? "step" : undefined}
            className={cn(
              "tile flex min-w-0 items-start gap-3",
              itemLayout[orientation],
              step.status === "current" && "border-accent bg-card ring-1 ring-accent"
            )}
          >
            <Icon
              aria-hidden="true"
              strokeWidth={1.75}
              className={cn("mt-0.5 h-6 w-6 shrink-0", iconColor[step.status])}
            />
            <div className="min-w-0">
              <p className="text-sm font-bold text-ink">
                <span className="text-body">{index + 1}. </span>
                {step.label}
              </p>
              <p
                className={cn(
                  "text-xs font-semibold",
                  step.status === "current" ? "text-accent" : step.status === "done" ? "text-buy" : "text-body"
                )}
              >
                {t(`status.${step.status}`)}
              </p>
              {step.description ? <p className="mt-1 text-sm text-body">{step.description}</p> : null}
              {step.status === "locked" && step.lockedReason ? (
                <p className="mt-1 text-sm text-body">{step.lockedReason}</p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
