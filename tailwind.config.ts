import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./app/**/*.{ts,tsx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "1.5rem",
      screens: { "2xl": "1280px" },
    },
    extend: {
      fontFamily: {
        sans: [
          "var(--font-sans)",
          "var(--font-sans-ar)",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
        arabic: [
          "var(--font-sans-ar)",
          "var(--font-sans)",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
        mono: [
          "var(--font-mono)",
          "ui-monospace",
          "SFMono-Regular",
          "monospace",
        ],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        /* Light neomorphic "precision / engineering" brand palette.
           Token names are unchanged from the dark era so existing pages keep
           working; the values are remapped to the light + cobalt system. */
        azure: {
          DEFAULT: "#0e59c5", // cobalt accent
          bright: "#1366d6",
          light: "#3b82f6",
        },
        cobalt: {
          DEFAULT: "#0e59c5",
          hover: "#0c4eb0",
        },
        ink: "#1c2434",
        surface: "#eef2f7",
        panel: "#e6ebf2", // recessed surface
        heading: "#1c2434",
        body: "#475569",
        mutedtext: "#64748b",
        faint: "#94a3b8",
        borderstrong: "#d3dbe6",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      boxShadow: {
        neu: "6px 6px 16px rgba(163,177,198,0.5), -6px -6px 16px rgba(255,255,255,0.85)",
        "neu-lg":
          "10px 10px 28px rgba(163,177,198,0.55), -10px -10px 28px rgba(255,255,255,0.9)",
        "neu-hover":
          "8px 8px 20px rgba(163,177,198,0.6), -8px -8px 20px rgba(255,255,255,0.95)",
        "neu-inset":
          "inset 4px 4px 10px rgba(163,177,198,0.45), inset -4px -4px 10px rgba(255,255,255,0.9)",
        "neu-sm":
          "4px 4px 10px rgba(163,177,198,0.45), -4px -4px 10px rgba(255,255,255,0.9)",
      },
      transitionTimingFunction: {
        spring: "cubic-bezier(0.32, 0.72, 0, 1)",
      },
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(16px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.7s cubic-bezier(0.32,0.72,0,1) both",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
// Gestaltung light-neomorphic theme — cobalt accent, Outfit + JetBrains Mono.
