"use client";

import { useEffect } from "react";
import { markAccountRoute } from "@/components/site/account-route";

export function AccountRouteMark() {
  useEffect(() => {
    markAccountRoute(true);
    return () => markAccountRoute(false);
  }, []);
  return null;
}
