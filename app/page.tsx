import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6">
      {/* subtle metallic backdrop */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-70"
        style={{
          background:
            "radial-gradient(60% 60% at 50% 35%, hsl(210 30% 18%) 0%, hsl(220 20% 7%) 60%, hsl(220 22% 5%) 100%)",
        }}
      />

      <div className="flex flex-col items-center text-center">
        <span className="mb-6 rounded-full border border-border bg-card/60 px-4 py-1 text-xs uppercase tracking-[0.2em] text-muted-foreground">
          Lusail · Qatar
        </span>

        <h1 className="bg-gradient-to-b from-primary to-foreground bg-clip-text text-6xl font-semibold tracking-tight text-transparent sm:text-7xl">
          Gestaltung
        </h1>

        <p className="mt-5 max-w-xl text-balance text-lg text-muted-foreground sm:text-xl">
          Manufacturing, made simple. Upload your design — we match it to the
          right production method and partner workshop across Qatar, then
          deliver the finished part.
        </p>

        <div className="mt-10 flex items-center gap-3">
          <Button size="lg">Get started</Button>
          <Button size="lg" variant="outline">
            How it works
          </Button>
        </div>

        <p className="mt-16 text-xs text-muted-foreground/70">
          Stage 1 — scaffold &amp; deploy. More coming soon.
        </p>
      </div>
    </main>
  );
}
