import type { NextConfig } from "next";

// Accounts need both keys, and one of them alone must leave the guest product exactly as it is.
const accounts = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);

const SECURITY_HEADERS = [
  // X-Frame-Options for the browsers that predate frame-ancestors. No script-src: nonces can't work with a static shell.
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Web Authentication stays out of this list, because sign-in may need it.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()" },
];

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_ACCOUNTS: accounts ? "1" : "" },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": { loaders: ["@tailwindcss/turbopack"], as: "*.css" },
    },
  },
  // English has no prefix. The root layout lives under [lang], so <html lang> follows the route
  // and "/" stays a static file with no proxy in front of it.
  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      {
        source: "/:lang(pt-br)?/:page(me|settings|welcome|admin|r|sign-in|sign-up)/:rest*",
        headers: [{ key: "X-Robots-Tag", value: "noindex" }],
      },
    ];
  },
  async redirects() {
    return [
      { source: "/en", destination: "/", permanent: true },
      { source: "/en/:path*", destination: "/:path*", permanent: true },
    ];
  },
  async rewrites() {
    return {
      beforeFiles: [
        { source: "/", destination: "/en" },
        {
          source: "/:path((?!en(?:/|$)|pt-br(?:/|$)|api(?:/|$)|_next(?:/|$)|__clerk(?:/|$)|.*\\..*).*)",
          destination: "/en/:path",
        },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
