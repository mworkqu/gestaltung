import { cn } from "@/lib/utils";

/**
 * An email's HTML in a sandboxed iframe (no scripts, no forms, no navigation:
 * `sandbox=""`), so a preview can never run code or leave the page. The
 * plain-text twin is a <pre>.
 */
export function EmailFrame({ html, title, className }: { html: string; title: string; className?: string }) {
  return <iframe title={title} srcDoc={html} sandbox="" referrerPolicy="no-referrer" className={cn("h-[560px] w-full rounded-xl border border-border bg-white", className)} />;
}

export function EmailText({ text, className }: { text: string; className?: string }) {
  return (
    <pre dir="auto" className={cn("max-h-[560px] overflow-auto whitespace-pre-wrap break-words rounded-xl border border-border bg-surface p-4 text-start text-sm leading-relaxed text-ink", className)}>
      {text}
    </pre>
  );
}
