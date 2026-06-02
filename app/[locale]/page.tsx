import { setRequestLocale } from "next-intl/server";
import { Wrench, ShoppingCart, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { GMark } from "@/components/g-mark";

const features = [
  {
    icon: Wrench,
    title: "Custom manufacturing",
    copy: "Upload, match, produce, deliver.",
    accent: true,
  },
  {
    icon: ShoppingCart,
    title: "Mechanical parts store",
    copy: "Screws, nuts, fasteners.",
    accent: true,
  },
  {
    icon: Sparkles,
    title: "AI design — soon",
    copy: "Describe it, we model it.",
    accent: false,
  },
];

export default async function Home({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden">
        {/* Subtle azure glow behind the left column */}
        <div
          aria-hidden
          className="pointer-events-none absolute -left-32 -top-24 -z-10 h-[640px] w-[640px] rounded-full"
          style={{
            background:
              "radial-gradient(circle, rgba(62,166,255,0.16) 0%, rgba(62,166,255,0.04) 38%, transparent 68%)",
          }}
        />

        <div className="container grid items-center gap-12 py-16 md:grid-cols-2 md:py-24">
          {/* Left column */}
          <div>
            <span className="text-xs font-semibold uppercase tracking-[0.22em] text-azure">
              Precision manufacturing · Qatar
            </span>

            <h1 className="mt-5 text-[2rem] font-semibold leading-[1.1] tracking-tight text-heading sm:text-[2.375rem]">
              From a CAD file to a finished part.
            </h1>

            <p className="mt-5 max-w-xl text-lg leading-relaxed text-body">
              Upload your design. We identify the right method — 3D printing,
              CNC, laser, EDM — route it to a Qatari workshop, and deliver the
              part.
            </p>

            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Button asChild size="lg">
                <a href="#upload">Get a quote</a>
              </Button>
              <Button asChild size="lg" variant="outline">
                <a href="#how-it-works">How it works</a>
              </Button>
            </div>
          </div>

          {/* Right column — blueprint panel */}
          <div className="relative flex min-h-[320px] items-center justify-center overflow-hidden rounded-xl border border-borderstrong bg-panel p-8 md:min-h-[420px]">
            <div
              aria-hidden
              className="bg-blueprint-grid absolute inset-0"
            />
            <div className="relative flex flex-col items-center">
              <GMark className="h-24 w-24 md:h-28 md:w-28" />
              <p className="mt-6 text-xs font-medium uppercase tracking-[0.28em] text-faint">
                STL · STEP · DXF · IGES
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Feature row */}
      <section id="how-it-works" className="container pb-20 md:pb-28">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {features.map(({ icon: Icon, title, copy, accent }) => (
            <div
              key={title}
              className={`rounded-lg border border-border bg-card p-6 ${
                accent ? "border-t-2 border-t-azure" : "border-t-2 border-t-borderstrong"
              }`}
            >
              <Icon
                className={`h-6 w-6 ${accent ? "text-azure" : "text-faint"}`}
                strokeWidth={1.75}
              />
              <h3 className="mt-4 text-lg font-semibold text-heading">
                {title}
              </h3>
              <p className="mt-2 text-sm text-mutedtext">{copy}</p>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
