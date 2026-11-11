import { inject } from "@vercel/analytics";
import { injectSpeedInsights } from "@vercel/speed-insights";

// The generic entry points, not the /next components: those read search params, which a route with ensureStatic can't do.
export function startTelemetry() {
  const basePath = process.env.NEXT_PUBLIC_VERCEL_OBSERVABILITY_BASEPATH;
  const config = process.env.NEXT_PUBLIC_VERCEL_OBSERVABILITY_CLIENT_CONFIG;
  inject({ framework: "next", basePath }, config);
  // Speed Insights needs a paid plan on this project (its toggle answers 402 on Hobby). Until it's switched on and this
  // flag is set, its script would 404 on every page.
  if (process.env.NEXT_PUBLIC_SPEED_INSIGHTS === "on") injectSpeedInsights({ framework: "next", basePath }, config);
}
