import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";

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
        mutedtext: "#5a6677", // 5.19:1 on the canvas — WCAG AA for body text
        // Signal colours — see the --buy / --inventory tokens in globals.css.
        buy: {
          DEFAULT: "hsl(var(--buy))",
          bg: "hsl(var(--buy-bg))",
        },
        inventory: {
          DEFAULT: "hsl(var(--inventory))",
          bg: "hsl(var(--inventory-bg))",
        },
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
  plugins: [
    require("tailwindcss-animate"),
    // Touch targets (WCAG 2.5.5 / DESIGN.md §8: 44 px minimum). Combine with
    // responsive variants to keep desktop compact, e.g. `max-md:tap-target`.
    //   tap-target    min 44 x 44 box (add inline-flex items-center justify-center
    //                 on the element when its content needs centring)
    //   tap-target-y  min 44 px tall, width left alone (inline links, rows)
    //   tap-hit       keeps the visual size but extends the hit area to 44 x 44
    //                 with an invisible ::after (for small icon buttons / chips
    //                 that must not grow). Needs a non-positioned element.
    //   tap-icon      small icon button: a real 44 x 44 centred box on phones
    //                 (< 768 px), and on larger screens it keeps its visual size
    //                 with the hit area extended like tap-hit. Don't combine
    //                 with hidden / absolute / fixed.
    plugin(({ addUtilities }) => {
      const hitArea = {
        content: '""',
        position: "absolute",
        top: "min(0px, calc((100% - 44px) / 2))",
        bottom: "min(0px, calc((100% - 44px) / 2))",
        left: "min(0px, calc((100% - 44px) / 2))",
        right: "min(0px, calc((100% - 44px) / 2))",
      };
      addUtilities({
        ".tap-icon": {
          position: "relative",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          "@media (max-width: 767.98px)": { minHeight: "44px", minWidth: "44px" },
        },
        ".tap-icon::after": hitArea,
        ".tap-target": { minHeight: "44px", minWidth: "44px" },
        ".tap-target-y": { minHeight: "44px" },
        ".tap-hit": { position: "relative" },
        ".tap-hit::after": hitArea,
      });
    }),
  ],
};

export default config;
// Gestaltung light-neomorphic theme — cobalt accent, Outfit + JetBrains Mono.
