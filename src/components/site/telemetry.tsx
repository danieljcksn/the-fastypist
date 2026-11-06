"use client";

import { useEffect } from "react";

const RETRY_MS = 5000;
const IDLE_TIMEOUT_MS = 4000;

/** Never during a run: the scripts wait for idle and then for the test to end, so they cost the key path nothing. */
export function Telemetry() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const start = () => {
      if (document.documentElement.dataset.typing !== undefined) {
        timer = setTimeout(start, RETRY_MS);
        return;
      }
      void import("./telemetry-load").then(
        (load) => load.startTelemetry(),
        () => {},
      );
    };
    if (typeof requestIdleCallback === "function") {
      const idle = requestIdleCallback(start, { timeout: IDLE_TIMEOUT_MS });
      return () => {
        cancelIdleCallback(idle);
        clearTimeout(timer);
      };
    }
    timer = setTimeout(start, IDLE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, []);
  return null;
}
