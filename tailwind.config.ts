import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      borderRadius: {
        DEFAULT: "2px",
        sm: "2px",
        md: "4px",
        lg: "6px",
        xl: "8px",
      },
      colors: {
        brand: {
          DEFAULT: "#5b5bf5",
          50: "#eef0ff",
          100: "#e0e3ff",
          500: "#5b5bf5",
          600: "#4a48e0",
          700: "#3e3cc4",
        },
        bg: "var(--bg)",
        surface: "var(--surface)",
        border: "var(--border)",
        muted: "var(--muted)",
        fg: "var(--fg)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
