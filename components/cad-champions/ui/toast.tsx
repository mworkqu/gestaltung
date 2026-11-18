"use client";

import * as React from "react";
import * as ToastPrimitive from "@radix-ui/react-toast";
import { CheckCircle2, Info, OctagonAlert, X, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { CC_EVENTS, track } from "@/lib/cad-champions/analytics";
import { cn } from "@/lib/utils";

type ToastTone = "success" | "error" | "info";

interface ToastItem {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
}

interface ToastApi {
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
}

const ToastContext = React.createContext<ToastApi | null>(null);

const MAX_VISIBLE = 3;
const DURATION_MS = 6000;

const toneStyles: Record<ToastTone, { icon: LucideIcon; color: string }> = {
  success: { icon: CheckCircle2, color: "text-buy" },
  error: { icon: OctagonAlert, color: "text-[#a1231f]" },
  info: { icon: Info, color: "text-accent" },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const t = useTranslations("CC.ui");
  const [items, setItems] = React.useState<ToastItem[]>([]);
  const counter = React.useRef(0);

  const push = React.useCallback((tone: ToastTone, title: string, description?: string) => {
    counter.current += 1;
    const id = counter.current;
    setItems((prev) => [...prev, { id, tone, title, description }].slice(-MAX_VISIBLE));
    track(CC_EVENTS.toastShown, { tone });
  }, []);

  const api = React.useMemo<ToastApi>(
    () => ({
      success: (title, description) => push("success", title, description),
      error: (title, description) => push("error", title, description),
      info: (title, description) => push("info", title, description),
    }),
    [push]
  );

  const remove = (id: number) => setItems((prev) => prev.filter((i) => i.id !== id));

  return (
    <ToastContext.Provider value={api}>
      <ToastPrimitive.Provider duration={DURATION_MS} label={t("toastRegion")} swipeDirection="right">
        {children}
        {items.map((item) => {
          const { icon: Icon, color } = toneStyles[item.tone];
          return (
            <ToastPrimitive.Root
              key={item.id}
              type={item.tone === "error" ? "foreground" : "background"}
              onOpenChange={(open) => {
                if (!open) remove(item.id);
              }}
              className={cn(
                "neu flex items-start gap-3 p-4 text-start",
                "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
                "motion-reduce:animate-none"
              )}
            >
              <Icon aria-hidden="true" strokeWidth={1.75} className={cn("mt-0.5 h-5 w-5 shrink-0", color)} />
              <div className="min-w-0 flex-1">
                <ToastPrimitive.Title className="text-sm font-bold text-ink">{item.title}</ToastPrimitive.Title>
                {item.description ? (
                  <ToastPrimitive.Description className="mt-0.5 text-sm text-body">
                    {item.description}
                  </ToastPrimitive.Description>
                ) : null}
              </div>
              <ToastPrimitive.Close
                aria-label={t("close")}
                className="relative -m-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-body hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
              >
                <X aria-hidden="true" strokeWidth={1.75} className="h-4 w-4" />
              </ToastPrimitive.Close>
            </ToastPrimitive.Root>
          );
        })}
        <ToastPrimitive.Viewport className="fixed bottom-20 end-4 z-50 m-0 flex w-[min(24rem,calc(100vw-2rem))] list-none flex-col gap-3 p-0 outline-none" />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider> (mounted in the CC layout).");
  return ctx;
}
