"use client";

import { useLayoutEffect } from "react";

/**
 * Next 16.4 prerenders a thrown notFound() as an empty error shell and draws the page in the browser, so the layout's
 * theme script never runs and only the root not-found may set a title. Both are done here instead, before first paint.
 */
export function NotFoundSync({ title }: { title: string }) {
  useLayoutEffect(() => {
    document.title = title;
    try {
      const saved = localStorage.getItem("fastypist:theme");
      if (saved === "light" || (saved === "system" && matchMedia("(prefers-color-scheme: light)").matches)) document.documentElement.dataset.theme = "light";
    } catch {}
  }, [title]);
  return null;
}
