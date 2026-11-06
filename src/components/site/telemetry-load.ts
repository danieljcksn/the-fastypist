import { inject } from "@vercel/analytics";
import { injectSpeedInsights } from "@vercel/speed-insights";

// The generic entry points, not the /next components: those read search params, which a route with ensureStatic can't do.
export function startTelemetry() {
  const basePath = process.env.NEXT_PUBLIC_VERCEL_OBSERVABILITY_BASEPATH;
  const config = process.env.NEXT_PUBLIC_VERCEL_OBSERVABILITY_CLIENT_CONFIG;
  inject({ framework: "next", basePath }, config);
  injectSpeedInsights({ framework: "next", basePath }, config);
}
