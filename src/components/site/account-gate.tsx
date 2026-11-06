"use client";

import { Component, lazy, Suspense, useEffect, useState } from "react";
import { signedInCookie } from "@/typing/ranked/pool";
import { isAccountRoute, subscribeAccountRoute } from "./account-route";

const Island = lazy(() => import("./account-island"));

/** Clerk failing to load, or a chunk gone after a deploy, costs the ranked flow and nothing else. Typing never knows. */
class Boundary extends Component<{ children: React.ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(error: unknown) {
    console.error("account island failed", error instanceof Error ? error.message : "unknown");
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** On idle, never during a run, and otherwise at the end of the test: data-typing leaving is that moment. */
function whenFreeOfRuns(task: () => void): () => void {
  const html = document.documentElement;
  let idleId = 0;
  let observer: MutationObserver | null = null;
  const settle = () => {
    if (html.dataset.typing === undefined) {
      observer?.disconnect();
      task();
      return;
    }
    if (observer) return;
    observer = new MutationObserver(settle);
    observer.observe(html, { attributes: true, attributeFilter: ["data-typing"] });
  };
  if (typeof requestIdleCallback === "function") idleId = requestIdleCallback(settle, { timeout: 2_000 });
  else idleId = window.setTimeout(settle, 200);
  return () => {
    observer?.disconnect();
    if (typeof cancelIdleCallback === "function") cancelIdleCallback(idleId);
    else clearTimeout(idleId);
  };
}

/** A guest never gets past the cookie check, so a guest loads no Clerk code and makes no Clerk request. */
export function AccountGate() {
  const [wanted, setWanted] = useState(false);
  useEffect(() => {
    let cancel = () => {};
    const check = () => {
      cancel();
      cancel = () => {};
      if (!isAccountRoute() && signedInCookie()) cancel = whenFreeOfRuns(() => setWanted(true));
    };
    check();
    const unsubscribe = subscribeAccountRoute(check);
    return () => {
      unsubscribe();
      cancel();
    };
  }, []);
  if (!wanted) return null;
  return (
    <Boundary>
      <Suspense fallback={null}>
        <Island />
      </Suspense>
    </Boundary>
  );
}
