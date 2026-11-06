import localFont from "next/font/local";

// display: optional because a late swap to a different advance would re-wrap a run in progress.
export const mono = localFont({
  src: "./fonts/red-hat-mono-450.woff2",
  weight: "450",
  display: "optional",
  variable: "--font-mono",
  adjustFontFallback: false,
  fallback: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
});

export const text = localFont({
  src: [
    { path: "./fonts/red-hat-text-400.woff2", weight: "400" },
    { path: "./fonts/red-hat-text-500.woff2", weight: "500" },
  ],
  display: "swap",
  variable: "--font-text",
  preload: false,
  adjustFontFallback: "Arial",
  fallback: ["ui-sans-serif", "system-ui", "sans-serif"],
});
