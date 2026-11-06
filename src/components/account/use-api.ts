"use client";

import { useAuth } from "@clerk/nextjs";
import { useCallback } from "react";

/** Bearer rather than cookie alone: the cookie can have lapsed, and a lapsed one reads as nobody on a POST. */
export function useApi() {
  const { getToken } = useAuth();
  return useCallback(
    async (path: string, init: { method?: string; body?: unknown } = {}): Promise<Response> => {
      const token = await getToken();
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      if (init.body !== undefined) headers["Content-Type"] = "application/json";
      return fetch(path, { method: init.method ?? "GET", headers, ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }) });
    },
    [getToken],
  );
}
