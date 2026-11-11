import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ReactNode } from "react";
import { ImageResponse } from "next/og";
import { Wordmark } from "@/components/site/wordmark";

export const OG_SIZE = { width: 1200, height: 630 };

// The image renderer can't read woff2, so this is the page's Red Hat Text unpacked to TrueType, read once per instance.
const font = readFile(join(process.cwd(), "src/app/fonts/red-hat-text-400.ttf"));

// --ground, --text, --secondary, --muted and --brand in the dark theme. The renderer has no stylesheet for var() to reach.
export const OG = { ground: "#0f0e0c", text: "#f6f5f2", secondary: "#c9c5be", muted: "#8f8a84", brand: "#ff5e1f" } as const;

/** The wordmark top left, then whatever the page has to say, on the column's left edge like the page itself. */
export async function boardImage(body: ReactNode): Promise<ImageResponse> {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          background: OG.ground,
          color: OG.text,
          fontFamily: "Red Hat Text",
        }}
      >
        <div style={{ display: "flex", height: 54 }}>{Wordmark({ ink: OG.muted, brand: OG.brand })}</div>
        <div style={{ display: "flex", flexDirection: "column" }}>{body}</div>
      </div>
    ),
    { ...OG_SIZE, fonts: [{ name: "Red Hat Text", data: await font, weight: 400, style: "normal" }] },
  );
}

/** A big figure with its unit beside it, as on the results screen. */
export function Figure({ value, unit }: { value: string; unit: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 20 }}>
      <div style={{ fontSize: 220, lineHeight: 1, letterSpacing: "-0.035em" }}>{value}</div>
      <div style={{ fontSize: 56, color: OG.muted }}>{unit}</div>
    </div>
  );
}

export function Caption({ children }: { children: ReactNode }) {
  return <div style={{ display: "flex", marginTop: 28, fontSize: 44, color: OG.secondary }}>{children}</div>;
}
