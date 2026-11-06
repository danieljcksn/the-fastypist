// Tokens rather than values, so Clerk's card follows the theme with no flash and no theme package. Clerk's defaults are a
// shadowed card on a tinted footer, both of which DESIGN rejects, so the card dissolves into the page.
export const clerkAppearance = {
  cssLayerName: "clerk",
  variables: {
    colorBackground: "var(--ground)",
    colorForeground: "var(--text)",
    colorMutedForeground: "var(--muted)",
    colorPrimary: "var(--brand)",
    colorPrimaryForeground: "var(--on-brand)",
    colorInput: "var(--surface)",
    colorInputForeground: "var(--text)",
    colorNeutral: "var(--text)",
    colorDanger: "var(--wrong)",
    colorWarning: "var(--extra)",
    colorSuccess: "var(--text)",
    colorRing: "var(--caret)",
    colorShadow: "transparent",
    colorBorder: "var(--rule)",
    fontFamily: "var(--font-text)",
    fontFamilyButtons: "var(--font-text)",
    borderRadius: "0.5rem",
  },
  elements: {
    rootBox: { width: "100%" },
    cardBox: { width: "100%", maxWidth: "26rem", boxShadow: "none", border: "none", borderRadius: "0", background: "transparent" },
    card: { background: "transparent", boxShadow: "none", border: "none", paddingInline: "0", paddingBlockStart: "0" },
    footer: { background: "transparent", border: "none" },
    headerTitle: { fontSize: "var(--t-xl)", fontWeight: "400", letterSpacing: "0" },
    headerSubtitle: { fontSize: "var(--t-m)", color: "var(--muted)" },
    header: { textAlign: "left" },
  },
} as const;
