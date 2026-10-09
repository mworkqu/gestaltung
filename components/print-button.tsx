"use client";

import { Printer } from "lucide-react";

import { Button } from "@/components/ui/button";

// Opens the browser print dialog (P2-05, the pilot proposal sheet). The label
// is passed in by the server page, so this component reads no messages and the
// route needs no MessagesScope. 44 px high; hidden when printing.
export function PrintButton({ label }: { label: string }) {
  return (
    <Button
      type="button"
      size="lg"
      className="w-full rounded-full print:hidden sm:w-auto"
      onClick={() => window.print()}
    >
      <Printer className="h-4 w-4" aria-hidden />
      {label}
    </Button>
  );
}
