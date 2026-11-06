import type { NextConfig } from "next";

// Accounts need both keys, and one of them alone must leave the guest product exactly as it is.
const accounts = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);

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
